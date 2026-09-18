-- Central de Leads — Fase 3 (custo por resultado)
--
-- Cache dos insights de campanha da Meta. Cada linha é o gasto de uma campanha
-- num período, lido com o token do próprio cliente (`ads_read`, já pedido no
-- OAuth desde sempre). O cache existe por dois motivos: a Graph API tem quota
-- por app, e o painel é consultado muitas vezes por dia com o mesmo recorte.

create table if not exists public.meta_ads_insights_cache (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  level text not null default 'campaign' check (level in ('campaign', 'adset', 'ad')),
  object_id text not null,
  object_name text null,
  period_from date not null,
  period_to date not null,
  spend numeric(14, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  reach bigint not null default 0,
  currency text null,
  /** Leads que a própria Meta contou — útil para comparar com o que chegou aqui. */
  meta_reported_leads integer not null default 0,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  created_at timestamptz not null default now(),
  unique (tenant_id, level, object_id, period_from, period_to)
);

create index if not exists meta_ads_insights_cache_lookup_idx
  on public.meta_ads_insights_cache (tenant_id, level, period_from, period_to);

create index if not exists meta_ads_insights_cache_expiry_idx
  on public.meta_ads_insights_cache (expires_at);

alter table public.meta_ads_insights_cache enable row level security;
revoke all on public.meta_ads_insights_cache from public, anon, authenticated;
grant select, insert, update, delete on public.meta_ads_insights_cache to service_role;
