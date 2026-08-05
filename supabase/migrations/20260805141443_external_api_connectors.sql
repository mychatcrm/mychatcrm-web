-- Tenant-scoped, read-only external API connectors for agents.
-- Browser roles never read these tables directly; authenticated Next.js routes
-- enforce owner-only mutations and return secret-free DTOs.

alter table public.billing_addon_catalog
  drop constraint if exists billing_addon_catalog_kind_check;
alter table public.billing_addon_catalog
  add constraint billing_addon_catalog_kind_check
  check (kind in ('lead_capacity', 'whatsapp_line', 'api_connector'));

alter table public.tenant_billing_entitlements
  drop constraint if exists tenant_billing_entitlements_kind_check;
alter table public.tenant_billing_entitlements
  add constraint tenant_billing_entitlements_kind_check
  check (kind in ('lead_capacity', 'whatsapp_line', 'api_connector'));

insert into public.billing_addon_catalog (
  code, title, description, kind, billing_mode, included_quantity,
  currency, amount_cents, interval_unit, active, metadata
) values (
  'api_connector_recurring',
  'Conector de API adicional',
  'Uma API REST/JSON adicional para consultas de agentes.',
  'api_connector',
  'recurring',
  1,
  'brl',
  4990,
  'month',
  false,
  jsonb_build_object('included_per_plan', 1, 'read_only', true)
)
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  included_quantity = excluded.included_quantity,
  currency = excluded.currency,
  amount_cents = excluded.amount_cents,
  interval_unit = excluded.interval_unit,
  metadata = public.billing_addon_catalog.metadata || excluded.metadata,
  updated_at = now();

create table if not exists public.external_api_connectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  base_url text not null check (char_length(base_url) <= 2048),
  base_origin text not null check (char_length(base_origin) <= 512),
  auth_type text not null default 'none'
    check (auth_type in ('none', 'bearer', 'api_key', 'basic')),
  auth_config jsonb not null default '{}'::jsonb,
  auth_header_name text null,
  auth_username text null,
  credential_ciphertext text null,
  credential_fingerprint text null,
  credential_key_version smallint not null default 1 check (credential_key_version > 0),
  enabled boolean not null default false,
  is_primary boolean not null default false,
  health_status text not null default 'untested'
    check (health_status in ('untested', 'healthy', 'degraded', 'error')),
  last_health_at timestamptz null,
  last_error_code text null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, base_origin, name)
);

create unique index if not exists external_api_connectors_one_primary_idx
  on public.external_api_connectors (tenant_id)
  where is_primary = true;
create index if not exists external_api_connectors_tenant_active_idx
  on public.external_api_connectors (tenant_id, enabled, created_at);

create table if not exists public.external_api_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  connector_id uuid not null,
  operation_key text not null check (operation_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  method text not null check (method in ('GET', 'POST')),
  path_template text not null check (path_template ~ '^/' and char_length(path_template) <= 1024),
  parameters jsonb not null default '[]'::jsonb,
  response_mapping jsonb not null default '{}'::jsonb,
  cache_ttl_seconds integer not null default 0
    check (cache_ttl_seconds in (0, 30, 60, 120, 300)),
  enabled boolean not null default true,
  position smallint not null default 0 check (position between 0 and 9),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connector_id, operation_key),
  foreign key (connector_id, tenant_id)
    references public.external_api_connectors (id, tenant_id)
    on delete cascade
);
create index if not exists external_api_operations_tenant_connector_idx
  on public.external_api_operations (tenant_id, connector_id, enabled);

create table if not exists public.agent_external_api_connectors (
  tenant_id text not null,
  agent_id text not null,
  connector_id uuid not null,
  created_by text null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, agent_id, connector_id),
  foreign key (tenant_id, agent_id)
    references public.tenant_agents (tenant_id, agent_id)
    on delete cascade,
  foreign key (connector_id, tenant_id)
    references public.external_api_connectors (id, tenant_id)
    on delete cascade
);
create index if not exists agent_external_api_connectors_connector_idx
  on public.agent_external_api_connectors (tenant_id, connector_id, agent_id);

create table if not exists public.external_api_cache (
  tenant_id text not null,
  connector_id uuid not null,
  operation_id uuid not null references public.external_api_operations(id) on delete cascade,
  cache_key text not null,
  normalized_result jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, connector_id, operation_id, cache_key),
  foreign key (connector_id, tenant_id)
    references public.external_api_connectors (id, tenant_id)
    on delete cascade
);
create index if not exists external_api_cache_expiry_idx
  on public.external_api_cache (expires_at);

create table if not exists public.external_api_call_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  connector_id uuid not null,
  operation_id uuid null,
  agent_id text null,
  job_id uuid null,
  journey_id uuid null,
  args_hash text null,
  status text not null check (status in ('success', 'cache_hit', 'blocked', 'error')),
  error_code text null,
  http_status integer null,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  result_count integer not null default 0 check (result_count >= 0),
  created_at timestamptz not null default now(),
  foreign key (connector_id, tenant_id)
    references public.external_api_connectors (id, tenant_id)
    on delete cascade,
  foreign key (operation_id)
    references public.external_api_operations (id)
    on delete set null
);
create index if not exists external_api_call_logs_tenant_created_idx
  on public.external_api_call_logs (tenant_id, created_at desc);
create index if not exists external_api_call_logs_connector_created_idx
  on public.external_api_call_logs (connector_id, created_at desc);

create table if not exists public.external_api_rate_windows (
  tenant_id text not null,
  connector_id uuid not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, connector_id),
  foreign key (connector_id, tenant_id)
    references public.external_api_connectors (id, tenant_id)
    on delete cascade
);

create or replace function public.consume_external_api_rate_limit(
  p_tenant_id text,
  p_connector_id uuid,
  p_limit integer default 60,
  p_window_seconds integer default 60
)
returns table (allowed boolean, remaining integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_count integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 60), 600));
  v_seconds integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
begin
  if coalesce(trim(p_tenant_id), '') = '' or p_connector_id is null then
    raise exception 'missing external api rate limit identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_connector_id::text, 0));

  select window_start, request_count into v_window, v_count
    from public.external_api_rate_windows
   where tenant_id = p_tenant_id and connector_id = p_connector_id
   for update;

  if not found or v_window + make_interval(secs => v_seconds) <= v_now then
    insert into public.external_api_rate_windows (
      tenant_id, connector_id, window_start, request_count, updated_at
    ) values (p_tenant_id, p_connector_id, v_now, 1, v_now)
    on conflict (tenant_id, connector_id) do update set
      window_start = excluded.window_start,
      request_count = 1,
      updated_at = excluded.updated_at;
    return query select true, greatest(0, v_limit - 1), v_now + make_interval(secs => v_seconds);
    return;
  end if;

  if v_count >= v_limit then
    return query select false, 0, v_window + make_interval(secs => v_seconds);
    return;
  end if;

  update public.external_api_rate_windows
     set request_count = request_count + 1, updated_at = v_now
   where tenant_id = p_tenant_id and connector_id = p_connector_id
   returning request_count into v_count;

  return query select true, greatest(0, v_limit - v_count), v_window + make_interval(secs => v_seconds);
end;
$$;

create or replace function public.set_external_api_primary(
  p_tenant_id text,
  p_connector_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_tenant_id), '') = '' or p_connector_id is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':external-api-primary', 0));
  if not exists (
    select 1 from public.external_api_connectors
     where tenant_id = p_tenant_id and id = p_connector_id
  ) then
    return false;
  end if;
  update public.external_api_connectors
     set is_primary = (id = p_connector_id), updated_at = now()
   where tenant_id = p_tenant_id;
  return true;
end;
$$;

create or replace function public.promote_external_api_primary_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_primary then
    update public.external_api_connectors
       set is_primary = true, updated_at = now()
     where id = (
       select id from public.external_api_connectors
        where tenant_id = old.tenant_id
        order by created_at, id
        limit 1
     );
  end if;
  return old;
end;
$$;

drop trigger if exists external_api_connector_promote_primary on public.external_api_connectors;
create trigger external_api_connector_promote_primary
after delete on public.external_api_connectors
for each row execute function public.promote_external_api_primary_after_delete();

alter table public.external_api_connectors enable row level security;
alter table public.external_api_operations enable row level security;
alter table public.agent_external_api_connectors enable row level security;
alter table public.external_api_cache enable row level security;
alter table public.external_api_call_logs enable row level security;
alter table public.external_api_rate_windows enable row level security;

revoke all on table public.external_api_connectors from anon, authenticated;
revoke all on table public.external_api_operations from anon, authenticated;
revoke all on table public.agent_external_api_connectors from anon, authenticated;
revoke all on table public.external_api_cache from anon, authenticated;
revoke all on table public.external_api_call_logs from anon, authenticated;
revoke all on table public.external_api_rate_windows from anon, authenticated;
revoke all on function public.consume_external_api_rate_limit(text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.set_external_api_primary(text, uuid) from public, anon, authenticated;
revoke all on function public.promote_external_api_primary_after_delete() from public, anon, authenticated;

grant select, insert, update, delete on table public.external_api_connectors to service_role;
grant select, insert, update, delete on table public.external_api_operations to service_role;
grant select, insert, update, delete on table public.agent_external_api_connectors to service_role;
grant select, insert, update, delete on table public.external_api_cache to service_role;
grant select, insert, update, delete on table public.external_api_call_logs to service_role;
grant select, insert, update, delete on table public.external_api_rate_windows to service_role;
grant execute on function public.consume_external_api_rate_limit(text, uuid, integer, integer) to service_role;
grant execute on function public.set_external_api_primary(text, uuid) to service_role;

comment on table public.external_api_connectors is
  'Encrypted tenant-owned REST/JSON connectors. Browser roles have no direct access.';
comment on table public.external_api_operations is
  'Declared read-only GET/POST operations; agents cannot choose arbitrary URLs or request fields.';
comment on table public.agent_external_api_connectors is
  'Explicit owner-controlled authorization from an agent to a connector.';
comment on table public.external_api_call_logs is
  'Secret-free connector audit records. Payloads and contact identifiers are intentionally excluded.';
