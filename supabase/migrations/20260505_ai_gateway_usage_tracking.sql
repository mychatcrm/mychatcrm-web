create extension if not exists pgcrypto;

create table if not exists public.ai_model_pricing (
  id bigserial primary key,
  provider text not null,
  model text not null,
  input_price_per_1k numeric(18,9) not null,
  output_price_per_1k numeric(18,9) not null,
  active_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists ai_model_pricing_provider_model_active_idx
  on public.ai_model_pricing (provider, model, active_from);

create table if not exists public.ai_usage_limits (
  id bigserial primary key,
  tenant_id text not null,
  agent_id text null,
  daily_tokens_hard bigint null,
  monthly_tokens_hard bigint null,
  daily_cost_usd_hard numeric(18,6) null,
  monthly_cost_usd_hard numeric(18,6) null,
  daily_cost_usd_soft numeric(18,6) null,
  monthly_cost_usd_soft numeric(18,6) null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_usage_limits_tenant_idx on public.ai_usage_limits (tenant_id, active);
create index if not exists ai_usage_limits_tenant_agent_idx on public.ai_usage_limits (tenant_id, agent_id, active);

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id text null,
  agent_id text not null,
  feature text not null,
  provider text not null,
  model text not null,
  prompt_excerpt text null,
  response_excerpt text null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(18,6) not null default 0,
  currency text not null default 'USD',
  status text not null check (status in ('success', 'error', 'blocked', 'timeout')),
  error_code text null,
  error_message_sanitized text null,
  provider_request_id text null,
  latency_ms integer null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_tenant_created_idx
  on public.ai_usage_logs (tenant_id, created_at desc);
create index if not exists ai_usage_logs_agent_created_idx
  on public.ai_usage_logs (agent_id, created_at desc);
create index if not exists ai_usage_logs_status_created_idx
  on public.ai_usage_logs (status, created_at desc);
create unique index if not exists ai_usage_logs_provider_request_id_unique
  on public.ai_usage_logs (provider_request_id) where provider_request_id is not null;

create table if not exists public.ai_usage_daily (
  day date not null,
  tenant_id text not null,
  agent_id text not null,
  model text not null,
  request_count integer not null default 0,
  success_count integer not null default 0,
  error_count integer not null default 0,
  blocked_count integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  estimated_cost_usd numeric(18,6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, tenant_id, agent_id, model)
);

create index if not exists ai_usage_daily_day_tenant_idx
  on public.ai_usage_daily (day, tenant_id);

create table if not exists public.ai_usage_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  agent_id text null,
  alert_type text not null,
  threshold_pct numeric(5,2) null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_alerts_tenant_created_idx
  on public.ai_usage_alerts (tenant_id, created_at desc);

insert into public.ai_model_pricing (provider, model, input_price_per_1k, output_price_per_1k)
values
  ('openai', 'gpt-4o-mini', 0.00015, 0.0006),
  ('openai', 'gpt-4o', 0.005, 0.015)
on conflict do nothing;
