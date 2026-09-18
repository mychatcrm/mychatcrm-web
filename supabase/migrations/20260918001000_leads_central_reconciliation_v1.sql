-- Central de Leads — Fase 2 (reconciliação Meta ↔ MyChatCRM)
--
-- O que a Meta registou num formulário e o que chegou aqui podem divergir:
-- conexão expirada, formulário fora das regras, webhook perdido, lead em
-- dead-letter. Hoje essa diferença é invisível para o cliente — ele só sabe que
-- "entrou menos lead" e não tem como provar.
--
-- Estas duas tabelas guardam o resultado da comparação e cada lead faltante
-- encontrado, para a importação poder ser feita depois, sob comando, sem
-- repetir a varredura na Graph API.

create table if not exists public.meta_lead_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  period_from date not null,
  period_to date not null,
  timezone text not null default 'America/Sao_Paulo',
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'partial')),
  pages_checked integer not null default 0,
  forms_checked integer not null default 0,
  meta_total integer not null default 0,
  local_total integer not null default 0,
  missing_total integer not null default 0,
  imported_total integer not null default 0,
  error_code text null,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  started_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_lead_reconciliation_runs_tenant_idx
  on public.meta_lead_reconciliation_runs (tenant_id, started_at desc);

-- Uma execução por tenant de cada vez: a varredura consome quota da Graph API.
create unique index if not exists meta_lead_reconciliation_runs_one_active_idx
  on public.meta_lead_reconciliation_runs (tenant_id)
  where status = 'running';

create table if not exists public.meta_lead_reconciliation_gaps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.meta_lead_reconciliation_runs(id) on delete cascade,
  tenant_id text not null,
  page_id text not null,
  form_id text null,
  form_name text null,
  leadgen_id text not null,
  lead_created_time timestamptz null,
  ad_id text null,
  status text not null default 'missing'
    check (status in ('missing', 'imported', 'import_failed', 'skipped')),
  import_error text null,
  imported_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (tenant_id, leadgen_id, run_id)
);

create index if not exists meta_lead_reconciliation_gaps_run_idx
  on public.meta_lead_reconciliation_gaps (run_id, status);

create index if not exists meta_lead_reconciliation_gaps_tenant_idx
  on public.meta_lead_reconciliation_gaps (tenant_id, created_at desc);

alter table public.meta_lead_reconciliation_runs enable row level security;
alter table public.meta_lead_reconciliation_gaps enable row level security;

revoke all on public.meta_lead_reconciliation_runs from public, anon, authenticated;
revoke all on public.meta_lead_reconciliation_gaps from public, anon, authenticated;

grant select, insert, update, delete on public.meta_lead_reconciliation_runs to service_role;
grant select, insert, update, delete on public.meta_lead_reconciliation_gaps to service_role;
