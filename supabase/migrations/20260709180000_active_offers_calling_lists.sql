-- Listas de ligação inteligentes: extensão de ofertas ativas

alter table public.active_offers
  add column if not exists created_via text not null default 'manual_crm',
  add column if not exists filter_snapshot jsonb null,
  add column if not exists distribution_mode text not null default 'shared_pool',
  add column if not exists archived_at timestamptz null;

create index if not exists active_offers_tenant_archived_idx
  on public.active_offers (tenant_id, archived_at nulls first, created_at desc);

create table if not exists public.active_offer_assignees (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  active_offer_id uuid not null references public.active_offers(id) on delete cascade,
  employee_id text not null,
  created_at timestamptz not null default now(),
  unique (active_offer_id, employee_id)
);

create index if not exists active_offer_assignees_tenant_offer_idx
  on public.active_offer_assignees (tenant_id, active_offer_id);

create index if not exists active_offer_assignees_tenant_employee_idx
  on public.active_offer_assignees (tenant_id, employee_id);

create table if not exists public.active_offer_lead_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  active_offer_id uuid not null references public.active_offers(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_employee_id text null,
  disposition text not null default 'pending',
  attempt_count integer not null default 0,
  last_attempt_at timestamptz null,
  disposition_at timestamptz null,
  disposition_by text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (active_offer_id, lead_id)
);

create index if not exists active_offer_lead_progress_tenant_offer_idx
  on public.active_offer_lead_progress (tenant_id, active_offer_id);
create index if not exists active_offer_lead_progress_tenant_assignee_idx
  on public.active_offer_lead_progress (tenant_id, assigned_employee_id);
create index if not exists active_offer_lead_progress_disposition_idx
  on public.active_offer_lead_progress (active_offer_id, disposition);

create index if not exists leads_tenant_last_message_at_idx
  on public.leads (tenant_id, last_message_at);

alter table public.active_offer_assignees enable row level security;
alter table public.active_offer_lead_progress enable row level security;

grant select, insert, update, delete on table public.active_offer_assignees to service_role;
grant select, insert, update, delete on table public.active_offer_lead_progress to service_role;

-- Backfill progress rows for legacy offers
insert into public.active_offer_lead_progress (tenant_id, active_offer_id, lead_id, disposition)
select aol.tenant_id, aol.active_offer_id, aol.lead_id, 'pending'
from public.active_offer_leads aol
on conflict (active_offer_id, lead_id) do nothing;

-- Filter helper: returns matching lead ids + total count via window function
create or replace function public.active_offer_match_leads(
  p_tenant_id text,
  p_statuses text[] default null,
  p_min_days_inactive integer default null,
  p_owner_ids text[] default null,
  p_include_unassigned boolean default true,
  p_sources text[] default null,
  p_exclude_opt_out boolean default true,
  p_limit integer default 5000,
  p_offset integer default 0
)
returns table (
  lead_id uuid,
  total_count bigint
)
language sql
stable
as $$
  with filtered as (
    select
      l.id,
      count(*) over () as total_count
    from public.leads l
    where l.tenant_id = p_tenant_id
      and (p_statuses is null or cardinality(p_statuses) = 0 or l.status = any (p_statuses))
      and (
        p_min_days_inactive is null
        or coalesce(l.last_message_at, l.last_seen, l.updated_at, l.created_at)
           < (now() - (p_min_days_inactive || ' days')::interval)
      )
      and (
        p_owner_ids is null
        or cardinality(p_owner_ids) = 0
        or (
          (p_include_unassigned and l.owner_employee_id is null)
          or l.owner_employee_id = any (p_owner_ids)
        )
      )
      and (p_sources is null or cardinality(p_sources) = 0 or l.source = any (p_sources))
      and (
        not p_exclude_opt_out
        or l.whatsapp_opt_out_at is null
      )
    order by coalesce(l.last_message_at, l.last_seen, l.updated_at, l.created_at) asc nulls first
    offset greatest(p_offset, 0)
    limit least(greatest(p_limit, 1), 5000)
  )
  select f.id as lead_id, f.total_count from filtered f;
$$;

grant execute on function public.active_offer_match_leads(text, text[], integer, text[], boolean, text[], boolean, integer, integer) to service_role;
