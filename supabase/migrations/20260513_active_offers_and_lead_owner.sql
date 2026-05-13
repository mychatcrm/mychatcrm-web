alter table public.leads
  add column if not exists owner_employee_id text null;

create index if not exists leads_tenant_owner_employee_idx
  on public.leads (tenant_id, owner_employee_id);

create table if not exists public.active_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  title text not null,
  status text not null default 'active',
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.active_offer_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  active_offer_id uuid not null references public.active_offers(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (active_offer_id, lead_id)
);

create index if not exists active_offers_tenant_created_idx
  on public.active_offers (tenant_id, created_at desc);

create index if not exists active_offer_leads_tenant_offer_idx
  on public.active_offer_leads (tenant_id, active_offer_id);

create index if not exists active_offer_leads_tenant_lead_idx
  on public.active_offer_leads (tenant_id, lead_id);

alter table public.active_offers enable row level security;
alter table public.active_offer_leads enable row level security;

grant select, insert, update, delete on table public.active_offers to service_role;
grant select, insert, update, delete on table public.active_offer_leads to service_role;
