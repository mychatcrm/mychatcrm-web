-- Central de Leads — Fase 1 (fundação)
--
-- 1. Arquivamento em vez de apagar: `meta_lead_events` é a fonte da verdade do
--    lead pago e não pode sumir com um clique. O DELETE antigo continua a
--    existir na API por compatibilidade, mas o painel passa a arquivar.
-- 2. Índices para os filtros do super filtro rodarem no banco (campanha,
--    conjunto, anúncio, formulário, página, estado, lead do CRM e busca livre).
-- 3. Sem trigger, sem cron, sem reprocessamento histórico — só colunas e índices.


alter table public.meta_lead_events
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by text null;

comment on column public.meta_lead_events.archived_at is
  'Arquivado na Central de Leads. Continua no banco e no export; sai da lista padrão.';
comment on column public.meta_lead_events.archived_by is
  'employee_id (ou "owner") de quem arquivou — auditoria fica em operational_audit_events.';

-- Lista padrão: tenant + não arquivado, ordenado por entrada (keyset usa (created_at, id)).
create index if not exists meta_lead_events_tenant_active_created_idx
  on public.meta_lead_events (tenant_id, created_at desc, id desc)
  where archived_at is null;

create index if not exists meta_lead_events_tenant_archived_created_idx
  on public.meta_lead_events (tenant_id, archived_at desc)
  where archived_at is not null;

-- Recortes de atribuição.
create index if not exists meta_lead_events_tenant_campaign_idx
  on public.meta_lead_events (tenant_id, campaign_id, created_at desc)
  where campaign_id is not null;

create index if not exists meta_lead_events_tenant_adset_idx
  on public.meta_lead_events (tenant_id, adset_id, created_at desc)
  where adset_id is not null;

create index if not exists meta_lead_events_tenant_ad_idx
  on public.meta_lead_events (tenant_id, ad_id, created_at desc)
  where ad_id is not null;

create index if not exists meta_lead_events_tenant_form_idx
  on public.meta_lead_events (tenant_id, form_id, created_at desc)
  where form_id is not null;

create index if not exists meta_lead_events_tenant_page_idx
  on public.meta_lead_events (tenant_id, page_id, created_at desc);

-- Estado do pipeline (os baldes Novo/OK/Sem regra/Erro e os selects de status).
create index if not exists meta_lead_events_tenant_crm_status_idx
  on public.meta_lead_events (tenant_id, crm_sync_status, created_at desc);

create index if not exists meta_lead_events_tenant_wa_status_idx
  on public.meta_lead_events (tenant_id, whatsapp_status, created_at desc);

create index if not exists meta_lead_events_tenant_agent_idx
  on public.meta_lead_events (tenant_id, agent_id, created_at desc)
  where agent_id is not null;

-- Junção com o CRM (resultado do lead, fase 3) e recorte por equipe/dono.
create index if not exists meta_lead_events_tenant_lead_idx
  on public.meta_lead_events (tenant_id, lead_id)
  where lead_id is not null;

-- Busca livre por nome, telefone e e-mail sem varrer a tabela inteira.
--
-- O trigram é uma otimização, não um requisito: a busca funciona sem ele, só
-- mais devagar. Por isso a criação é tolerante — `pg_trgm` pode já existir
-- noutro schema numa base antiga, e o nome do operador vem qualificado pelo
-- schema da extensão. Uma migração não pode falhar inteira por causa de um
-- índice acessório.
do $$
declare
  v_schema text;
begin
  begin
    create extension if not exists pg_trgm with schema extensions;
  exception when others then
    null;
  end;

  select n.nspname into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';

  if v_schema is null then
    raise notice 'pg_trgm indisponível — busca livre segue sem índice de trigram';
    return;
  end if;

  execute format(
    'create index if not exists meta_lead_events_name_trgm_idx
       on public.meta_lead_events using gin (name %I.gin_trgm_ops) where name is not null',
    v_schema
  );
  execute format(
    'create index if not exists meta_lead_events_phone_trgm_idx
       on public.meta_lead_events using gin (phone %I.gin_trgm_ops) where phone is not null',
    v_schema
  );
  execute format(
    'create index if not exists meta_lead_events_email_trgm_idx
       on public.meta_lead_events using gin (email %I.gin_trgm_ops) where email is not null',
    v_schema
  );
end $$;
