-- Ordem durável dos cards do CRM.
--
-- A posição era mantida apenas no React/localStorage. A cada reconciliação a
-- API voltava a ordenar por created_at, desfazendo o arraste manual. Numeric
-- permite inserir entre dois cards sem renumerar a coluna inteira.

alter table public.leads
  add column if not exists crm_position numeric null;

comment on column public.leads.crm_position is
  'Ordem crescente e durável do card dentro de crm_funnel_id + status.';

with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, coalesce(crm_funnel_id, 'funil-default'), coalesce(status, 'novo')
      order by created_at desc, id
    ) * 1024::bigint as position
  from public.leads
  where crm_position is null
)
update public.leads as lead
set crm_position = ranked.position
from ranked
where lead.id = ranked.id;

alter table public.leads
  alter column crm_position set default 0,
  alter column crm_position set not null;

create index if not exists leads_tenant_funnel_status_position_idx
  on public.leads (tenant_id, crm_funnel_id, status, crm_position, created_at desc);

-- Entradas novas continuam aparecendo no topo, como acontecia com a antiga
-- ordem por created_at desc. O lock impede duas inserções simultâneas de
-- receberem a mesma posição no mesmo tenant/coluna.
create or replace function public.assign_new_crm_lead_position_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.crm_position = 0 then
    perform pg_advisory_xact_lock(hashtextextended(
      'crm-card-insert:' || new.tenant_id || ':' || coalesce(new.crm_funnel_id, 'funil-default') || ':' || coalesce(new.status, 'novo'),
      0
    ));

    select coalesce(min(lead.crm_position), 2048) - 1024
      into new.crm_position
    from public.leads as lead
    where lead.tenant_id = new.tenant_id
      and coalesce(lead.crm_funnel_id, 'funil-default') = coalesce(new.crm_funnel_id, 'funil-default')
      and coalesce(lead.status, 'novo') = coalesce(new.status, 'novo');
  end if;
  return new;
end;
$$;

drop trigger if exists leads_assign_new_crm_position on public.leads;
create trigger leads_assign_new_crm_position
before insert on public.leads
for each row execute function public.assign_new_crm_lead_position_v1();

-- Um único lock por tenant serializa apenas os arrastes manuais daquele CRM.
-- Isso deixa a escolha dos vizinhos e a gravação da posição atômicas, sem
-- interferir em mensagens, agenda ou automações dos agentes.
create or replace function public.move_crm_lead_card_v1(
  p_tenant_id text,
  p_lead_id uuid,
  p_funnel_id text,
  p_status text,
  p_previous_lead_id uuid default null,
  p_next_lead_id uuid default null
)
returns table (
  lead_id uuid,
  funnel_id text,
  column_id text,
  card_position numeric,
  changed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_previous_position numeric;
  v_next_position numeric;
  v_position numeric;
  v_now timestamptz := clock_timestamp();
  v_changed_column boolean;
begin
  if nullif(btrim(p_tenant_id), '') is null
     or nullif(btrim(p_funnel_id), '') is null
     or nullif(btrim(p_status), '') is null then
    raise exception 'invalid_crm_move_target' using errcode = '22023';
  end if;
  if p_previous_lead_id = p_lead_id or p_next_lead_id = p_lead_id
     or (p_previous_lead_id is not null and p_previous_lead_id = p_next_lead_id) then
    raise exception 'invalid_crm_move_neighbors' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('crm-card-move:' || p_tenant_id, 0));

  select lead.*
    into v_lead
  from public.leads as lead
  where lead.tenant_id = p_tenant_id
    and lead.id = p_lead_id
  for update;

  if not found then
    raise exception 'crm_lead_not_found' using errcode = 'P0002';
  end if;

  v_changed_column :=
    coalesce(v_lead.crm_funnel_id, 'funil-default') <> p_funnel_id
    or coalesce(v_lead.status, 'novo') <> p_status;

  if p_previous_lead_id is not null then
    select lead.crm_position
      into v_previous_position
    from public.leads as lead
    where lead.tenant_id = p_tenant_id
      and lead.id = p_previous_lead_id
      and lead.id <> p_lead_id
      and coalesce(lead.crm_funnel_id, 'funil-default') = p_funnel_id
      and coalesce(lead.status, 'novo') = p_status
    for update;
    if not found then
      raise exception 'crm_previous_neighbor_not_found' using errcode = '22023';
    end if;
  end if;

  if p_next_lead_id is not null then
    select lead.crm_position
      into v_next_position
    from public.leads as lead
    where lead.tenant_id = p_tenant_id
      and lead.id = p_next_lead_id
      and lead.id <> p_lead_id
      and coalesce(lead.crm_funnel_id, 'funil-default') = p_funnel_id
      and coalesce(lead.status, 'novo') = p_status
    for update;
    if not found then
      raise exception 'crm_next_neighbor_not_found' using errcode = '22023';
    end if;
  end if;

  -- Se muitas inserções fracionárias consumirem o intervalo, renumera somente
  -- a coluna alvo e volta a calcular os dois vizinhos.
  if v_previous_position is not null and v_next_position is not null
     and v_next_position - v_previous_position <= 0.000001 then
    with ordered as (
      select
        lead.id,
        row_number() over (order by lead.crm_position, lead.created_at desc, lead.id) * 1024::bigint as new_position
      from public.leads as lead
      where lead.tenant_id = p_tenant_id
        and coalesce(lead.crm_funnel_id, 'funil-default') = p_funnel_id
        and coalesce(lead.status, 'novo') = p_status
    )
    update public.leads as lead
    set crm_position = ordered.new_position
    from ordered
    where lead.id = ordered.id;

    select crm_position into v_previous_position
    from public.leads where tenant_id = p_tenant_id and id = p_previous_lead_id;
    select crm_position into v_next_position
    from public.leads where tenant_id = p_tenant_id and id = p_next_lead_id;
  end if;

  if v_previous_position is not null and v_next_position is not null then
    if v_previous_position >= v_next_position then
      raise exception 'stale_crm_move_neighbors' using errcode = '40001';
    end if;
    v_position := (v_previous_position + v_next_position) / 2;
  elsif v_previous_position is not null then
    v_position := v_previous_position + 1024;
  elsif v_next_position is not null then
    v_position := v_next_position - 1024;
  else
    select coalesce(max(lead.crm_position), 0) + 1024
      into v_position
    from public.leads as lead
    where lead.tenant_id = p_tenant_id
      and lead.id <> p_lead_id
      and coalesce(lead.crm_funnel_id, 'funil-default') = p_funnel_id
      and coalesce(lead.status, 'novo') = p_status;
  end if;

  update public.leads as lead
  set crm_funnel_id = p_funnel_id,
      status = p_status,
      crm_position = v_position,
      updated_at = case when v_changed_column then v_now else lead.updated_at end
  where lead.tenant_id = p_tenant_id
    and lead.id = p_lead_id;

  return query
  select lead.id, coalesce(lead.crm_funnel_id, 'funil-default'), coalesce(lead.status, 'novo'), lead.crm_position, lead.updated_at
  from public.leads as lead
  where lead.tenant_id = p_tenant_id
    and lead.id = p_lead_id;
end;
$$;

revoke all on function public.assign_new_crm_lead_position_v1() from public, anon, authenticated;
revoke all on function public.move_crm_lead_card_v1(text, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_new_crm_lead_position_v1() to service_role;
grant execute on function public.move_crm_lead_card_v1(text, uuid, text, text, uuid, uuid) to service_role;
