-- Operational Audit V1
-- Append-only, service-role-only ledger. No message bodies, prompts or secrets.

create table if not exists public.operational_audit_events (
  id uuid not null default gen_random_uuid(),
  operation_id uuid not null,
  trace_id uuid not null,
  span_id uuid not null default gen_random_uuid(),
  parent_span_id uuid,
  occurred_at timestamptz not null default now(),
  persisted_at timestamptz not null default now(),
  tenant_id text,
  actor_type text not null check (actor_type in ('customer','administrator','agent','system','webhook','cron','worker','external_integration')),
  actor_id text,
  module text not null,
  action text not null,
  resource_type text,
  resource_id text,
  status text not null check (status in ('pending','running','completed','blocked','cancelled','error')),
  severity text not null default 'info' check (severity in ('debug','info','warning','error','critical')),
  is_critical boolean not null default false,
  channel text,
  integration text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  attempt integer not null default 1 check (attempt > 0),
  result_code text,
  idempotency_key text,
  related_ids jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  deployment_sha text,
  contract_version smallint not null default 1,
  primary key (id, occurred_at),
  check (octet_length(metadata::text) <= 16384),
  check (octet_length(related_ids::text) <= 8192)
) partition by range (occurred_at);

create table if not exists public.operational_audit_events_default
  partition of public.operational_audit_events default;

create index if not exists operational_audit_events_occurred_idx
  on public.operational_audit_events (occurred_at desc, id desc);
create index if not exists operational_audit_events_trace_idx
  on public.operational_audit_events (trace_id, occurred_at asc);
create index if not exists operational_audit_events_operation_idx
  on public.operational_audit_events (operation_id, occurred_at asc);
create index if not exists operational_audit_events_tenant_idx
  on public.operational_audit_events (tenant_id, occurred_at desc) where tenant_id is not null;
create index if not exists operational_audit_events_status_idx
  on public.operational_audit_events (status, severity, occurred_at desc);
create index if not exists operational_audit_events_resource_idx
  on public.operational_audit_events (resource_type, resource_id, occurred_at desc)
  where resource_id is not null;

create table if not exists public.operational_audit_operations (
  operation_id uuid primary key,
  trace_id uuid not null,
  tenant_id text,
  module text not null,
  action text not null,
  resource_type text,
  resource_id text,
  status text not null,
  severity text not null,
  is_critical boolean not null default false,
  actor_type text not null,
  actor_id text,
  channel text,
  integration text,
  started_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  duration_ms integer,
  result_code text,
  event_count integer not null default 1,
  deployment_sha text
);

create index if not exists operational_audit_operations_updated_idx
  on public.operational_audit_operations (updated_at desc, operation_id desc);
create index if not exists operational_audit_operations_trace_idx
  on public.operational_audit_operations (trace_id, updated_at desc);
create index if not exists operational_audit_operations_state_idx
  on public.operational_audit_operations (status, severity, updated_at desc);

create table if not exists public.operational_audit_trace_links (
  entity_type text not null,
  entity_id text not null,
  trace_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (entity_type, entity_id)
);
create index if not exists operational_audit_trace_links_trace_idx
  on public.operational_audit_trace_links (trace_id);

create table if not exists public.operational_audit_exports (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null default gen_random_uuid(),
  requested_by_admin_id text not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','expired')),
  format text not null check (format in ('csv','json','ndjson')),
  filters jsonb not null default '{}'::jsonb,
  range_start timestamptz not null,
  range_end timestamptz not null,
  row_count integer,
  filename text,
  content_type text,
  payload bytea,
  checksum_sha256 text,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  check (range_end > range_start),
  check (range_end <= range_start + interval '31 days')
);
create index if not exists operational_audit_exports_admin_idx
  on public.operational_audit_exports (requested_by_admin_id, created_at desc);
create unique index if not exists operational_audit_exports_operation_idx
  on public.operational_audit_exports (operation_id);

create table if not exists public.operational_audit_monthly_summaries (
  month_start date not null,
  module text not null,
  status text not null,
  severity text not null,
  event_count bigint not null default 0,
  average_duration_ms numeric,
  critical_count bigint not null default 0,
  archived_object_key text,
  archived_checksum_sha256 text,
  archived_at timestamptz,
  primary key (month_start, module, status, severity)
);

create table if not exists public.operational_audit_archives (
  month_start date primary key,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','expired')),
  object_key text,
  checksum_sha256 text,
  row_count bigint,
  archived_at timestamptz,
  expires_at timestamptz,
  error_code text,
  updated_at timestamptz not null default now()
);

alter table public.operational_audit_events enable row level security;
alter table public.operational_audit_operations enable row level security;
alter table public.operational_audit_trace_links enable row level security;
alter table public.operational_audit_exports enable row level security;
alter table public.operational_audit_monthly_summaries enable row level security;
alter table public.operational_audit_archives enable row level security;

revoke all on public.operational_audit_events from public, anon, authenticated;
revoke all on public.operational_audit_operations from public, anon, authenticated;
revoke all on public.operational_audit_trace_links from public, anon, authenticated;
revoke all on public.operational_audit_exports from public, anon, authenticated;
revoke all on public.operational_audit_monthly_summaries from public, anon, authenticated;
revoke all on public.operational_audit_archives from public, anon, authenticated;
grant select, insert on public.operational_audit_events to service_role;
grant select, insert, update on public.operational_audit_operations to service_role;
grant select, insert on public.operational_audit_trace_links to service_role;
grant select, insert, update on public.operational_audit_exports to service_role;
grant select, insert, update on public.operational_audit_monthly_summaries to service_role;
grant select, insert, update, delete on public.operational_audit_archives to service_role;

do $audit_storage$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values (
        'operational-audit-archives', 'operational-audit-archives', false,
        52428800, array['application/gzip']::text[]
      )
      on conflict (id) do update set
        public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $sql$;
  end if;
end;
$audit_storage$;

create or replace function public.ensure_operational_audit_partitions_v1(p_reference timestamptz default now())
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_month date;
  v_name text;
begin
  for v_month in
    select (date_trunc('month', p_reference) + (n || ' months')::interval)::date
    from generate_series(-1, 2) as n
  loop
    v_name := 'operational_audit_events_' || to_char(v_month, 'YYYY_MM');
    execute format(
      'create table if not exists public.%I partition of public.operational_audit_events for values from (%L) to (%L)',
      v_name,
      v_month::timestamptz,
      (v_month + interval '1 month')::timestamptz
    );
  end loop;
end;
$$;

revoke all on function public.ensure_operational_audit_partitions_v1(timestamptz) from public, anon, authenticated;
grant execute on function public.ensure_operational_audit_partitions_v1(timestamptz) to service_role;
select public.ensure_operational_audit_partitions_v1(now());

create or replace function public.resolve_operational_trace_v1(p_related_ids jsonb, p_requested_trace uuid default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_trace uuid;
  v_item record;
begin
  if jsonb_typeof(coalesce(p_related_ids, '{}'::jsonb)) <> 'object' then
    p_related_ids := '{}'::jsonb;
  end if;

  select l.trace_id into v_trace
  from jsonb_each_text(p_related_ids) e
  join public.operational_audit_trace_links l
    on l.entity_type = e.key and l.entity_id = e.value
  where e.key in (
    'lead_id','journey_id','conversation_id','message_id','job_id','event_id',
    'campaign_id','outbox_id','operation_id','agenda_event_id',
    'evolution_inbox_id','meta_inbox_id','meta_event_id','audit_export_id','github_run_id'
  )
  order by l.created_at asc
  limit 1;

  v_trace := coalesce(v_trace, p_requested_trace, gen_random_uuid());

  for v_item in select key, value from jsonb_each_text(p_related_ids)
  loop
    if v_item.key in (
      'lead_id','journey_id','conversation_id','message_id','job_id','event_id',
      'campaign_id','outbox_id','operation_id','agenda_event_id',
      'evolution_inbox_id','meta_inbox_id','meta_event_id','audit_export_id','github_run_id'
    ) and length(v_item.value) between 1 and 300 then
      insert into public.operational_audit_trace_links(entity_type, entity_id, trace_id)
      values (v_item.key, v_item.value, v_trace)
      on conflict (entity_type, entity_id) do nothing;
    end if;
  end loop;

  return v_trace;
end;
$$;

revoke all on function public.resolve_operational_trace_v1(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.resolve_operational_trace_v1(jsonb, uuid) to service_role;

create or replace function public.refresh_operational_audit_operation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.operational_audit_operations (
    operation_id, trace_id, tenant_id, module, action, resource_type, resource_id,
    status, severity, is_critical, actor_type, actor_id, channel, integration,
    started_at, updated_at, completed_at, duration_ms, result_code, deployment_sha
  ) values (
    new.operation_id, new.trace_id, new.tenant_id, new.module, new.action,
    new.resource_type, new.resource_id, new.status, new.severity, new.is_critical,
    new.actor_type, new.actor_id, new.channel, new.integration, new.occurred_at,
    new.occurred_at,
    case when new.status in ('completed','blocked','cancelled','error') then new.occurred_at end,
    new.duration_ms, new.result_code, new.deployment_sha
  )
  on conflict (operation_id) do update set
    trace_id = excluded.trace_id,
    tenant_id = coalesce(excluded.tenant_id, public.operational_audit_operations.tenant_id),
    status = excluded.status,
    severity = excluded.severity,
    is_critical = public.operational_audit_operations.is_critical or excluded.is_critical,
    updated_at = excluded.updated_at,
    completed_at = excluded.completed_at,
    duration_ms = coalesce(excluded.duration_ms, public.operational_audit_operations.duration_ms),
    result_code = coalesce(excluded.result_code, public.operational_audit_operations.result_code),
    event_count = public.operational_audit_operations.event_count + 1,
    deployment_sha = coalesce(excluded.deployment_sha, public.operational_audit_operations.deployment_sha);
  return new;
end;
$$;

create trigger operational_audit_events_refresh_operation
after insert on public.operational_audit_events
for each row execute function public.refresh_operational_audit_operation_v1();

create or replace function public.prevent_operational_audit_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if current_setting('app.operational_audit_retention', true) is distinct from 'on' then
    raise exception 'operational_audit_events is append-only';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger operational_audit_events_immutable
before update or delete on public.operational_audit_events
for each row execute function public.prevent_operational_audit_mutation_v1();

create or replace function public.append_operational_audit_event_v1(
  p_operation_id uuid,
  p_trace_id uuid,
  p_parent_span_id uuid,
  p_tenant_id text,
  p_actor_type text,
  p_actor_id text,
  p_module text,
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_status text,
  p_severity text,
  p_is_critical boolean,
  p_channel text,
  p_integration text,
  p_duration_ms integer,
  p_attempt integer,
  p_result_code text,
  p_idempotency_key text,
  p_related_ids jsonb,
  p_metadata jsonb,
  p_deployment_sha text
)
returns table(event_id uuid, operation_id uuid, trace_id uuid, span_id uuid, occurred_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.operational_audit_events%rowtype;
  v_operation uuid := coalesce(p_operation_id, gen_random_uuid());
  v_trace uuid;
begin
  if p_actor_type not in ('customer','administrator','agent','system','webhook','cron','worker','external_integration')
    or p_status not in ('pending','running','completed','blocked','cancelled','error')
    or p_severity not in ('debug','info','warning','error','critical') then
    raise exception 'invalid operational audit enum';
  end if;
  if p_module !~ '^[a-z0-9_.:-]{1,80}$' or p_action !~ '^[a-z0-9_.:-]{1,120}$' then
    raise exception 'invalid operational audit identifier';
  end if;

  v_trace := public.resolve_operational_trace_v1(coalesce(p_related_ids, '{}'::jsonb), p_trace_id);
  insert into public.operational_audit_events (
    operation_id, trace_id, parent_span_id, tenant_id, actor_type, actor_id,
    module, action, resource_type, resource_id, status, severity, is_critical,
    channel, integration, duration_ms, attempt, result_code, idempotency_key,
    related_ids, metadata, deployment_sha
  ) values (
    v_operation, v_trace, p_parent_span_id, p_tenant_id, p_actor_type, p_actor_id,
    p_module, p_action, p_resource_type, p_resource_id, p_status, p_severity,
    coalesce(p_is_critical, false), p_channel, p_integration,
    greatest(coalesce(p_duration_ms, 0), 0), greatest(coalesce(p_attempt, 1), 1),
    left(p_result_code, 160), left(p_idempotency_key, 300),
    coalesce(p_related_ids, '{}'::jsonb), coalesce(p_metadata, '{}'::jsonb),
    left(p_deployment_sha, 80)
  ) returning * into v_event;

  return query select v_event.id, v_event.operation_id, v_event.trace_id, v_event.span_id, v_event.occurred_at;
end;
$$;

revoke all on function public.append_operational_audit_event_v1(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text,
  boolean, text, text, integer, integer, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.append_operational_audit_event_v1(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text,
  boolean, text, text, integer, integer, text, text, jsonb, jsonb, text
) to service_role;

create or replace function public.summarize_operational_audit_month_v1(p_month date)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.operational_audit_monthly_summaries (
    month_start, module, status, severity, event_count, average_duration_ms, critical_count
  )
  select date_trunc('month', occurred_at)::date, module, status, severity,
         count(*), avg(duration_ms), count(*) filter (where is_critical)
  from public.operational_audit_events
  where occurred_at >= date_trunc('month', p_month::timestamptz)
    and occurred_at < date_trunc('month', p_month::timestamptz) + interval '1 month'
  group by 1, 2, 3, 4
  on conflict (month_start, module, status, severity) do update set
    event_count = excluded.event_count,
    average_duration_ms = excluded.average_duration_ms,
    critical_count = excluded.critical_count;
end;
$$;
revoke all on function public.summarize_operational_audit_month_v1(date) from public, anon, authenticated;
grant execute on function public.summarize_operational_audit_month_v1(date) to service_role;

create or replace function public.get_operational_audit_dashboard_v1(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with scoped as (
    select status, severity, is_critical, duration_ms, module
    from public.operational_audit_events
    where occurred_at >= p_from and occurred_at < p_to
  ), states as (
    select status, count(*)::bigint as total from scoped group by status
  ), providers as (
    select module, count(*) filter (where status = 'error')::bigint as errors
    from scoped group by module order by errors desc, module limit 10
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'success', (select count(*) from scoped where status = 'completed'),
    'errors', (select count(*) from scoped where status = 'error'),
    'blocked', (select count(*) from scoped where status = 'blocked'),
    'cancelled', (select count(*) from scoped where status = 'cancelled'),
    'running', (select count(*) from scoped where status in ('pending','running')),
    'critical', (select count(*) from scoped where is_critical or severity = 'critical'),
    'averageDurationMs', coalesce((select round(avg(duration_ms)) from scoped where duration_ms is not null), 0),
    'watchdogLastObservedAt', (select max(occurred_at) from public.operational_audit_events where module = 'runtime.watchdog' and action = 'check.completed'),
    'productionSha', (select deployment_sha from public.operational_audit_events where deployment_sha is not null order by occurred_at desc limit 1),
    'states', coalesce((select jsonb_object_agg(status, total) from states), '{}'::jsonb),
    'modulesWithErrors', coalesce((select jsonb_agg(to_jsonb(providers)) from providers), '[]'::jsonb)
  );
$$;
revoke all on function public.get_operational_audit_dashboard_v1(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_operational_audit_dashboard_v1(timestamptz, timestamptz) to service_role;

create or replace function public.capture_operational_table_change_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_status_raw text := lower(coalesce(v_row ->> 'status', 'completed'));
  v_status text;
  v_severity text := 'info';
  v_resource_id text := coalesce(v_row ->> 'id', v_row ->> 'event_id', v_row ->> 'job_id');
  v_tenant_id text := v_row ->> 'tenant_id';
  v_related jsonb := '{}'::jsonb;
  v_operation uuid := gen_random_uuid();
  v_trace uuid;
  v_key text;
begin
  if tg_op = 'DELETE' then v_status := 'cancelled';
  elsif v_status_raw ~ '(error|failed|dead)' then v_status := 'error';
  elsif v_status_raw ~ 'block' then v_status := 'blocked';
  elsif v_status_raw ~ 'cancel' then v_status := 'cancelled';
  elsif v_status_raw ~ '(pending|queued|scheduled)' then v_status := 'pending';
  elsif v_status_raw ~ '(processing|running|claimed)' then v_status := 'running';
  else v_status := 'completed';
  end if;
  if v_status = 'error' then v_severity := 'error'; end if;

  foreach v_key in array array[
    'id','tenant_id','lead_id','agent_id','journey_id','rule_id','conversation_id',
    'message_id','job_id','event_id','campaign_id','connection_id','outbox_id','operation_id'
  ] loop
    if nullif(v_row ->> v_key, '') is not null then
      v_related := v_related || jsonb_build_object(v_key, left(v_row ->> v_key, 300));
    end if;
  end loop;
  if v_resource_id is not null then
    v_key := case
      when tg_table_name = 'leads' then 'lead_id'
      when tg_table_name = 'lead_journeys' then 'journey_id'
      when tg_table_name in ('conversation_states','conversation_events') then 'conversation_id'
      when tg_table_name = 'whatsapp_messages' then 'message_id'
      when tg_table_name in ('agent_response_jobs','lead_redistribution_jobs','follow_up_jobs','agenda_reminder_jobs_v2') then 'job_id'
      when tg_table_name = 'agenda_events' then 'agenda_event_id'
      when tg_table_name in ('whatsapp_campaigns','whatsapp_campaign_recipients') then 'campaign_id'
      when tg_table_name in ('agent_outbound_outbox','agenda_notification_outbox','agenda_sync_outbox') then 'outbox_id'
      when tg_table_name = 'evolution_webhook_inbox' then 'evolution_inbox_id'
      when tg_table_name = 'meta_lead_events' then 'meta_event_id'
      else null
    end;
    if v_key is not null then
      v_related := v_related || jsonb_build_object(v_key, left(v_resource_id, 300));
    end if;
  end if;
  v_trace := public.resolve_operational_trace_v1(v_related, null);

  insert into public.operational_audit_events (
    operation_id, trace_id, tenant_id, actor_type, actor_id, module, action,
    resource_type, resource_id, status, severity, channel, integration,
    result_code, idempotency_key, related_ids, metadata, deployment_sha
  ) values (
    v_operation, v_trace, v_tenant_id, 'system', null,
    replace(tg_table_name, '_', '.'), lower(tg_op), tg_table_name, v_resource_id,
    v_status, v_severity, v_row ->> 'channel',
    coalesce(v_row ->> 'provider', v_row ->> 'integration'),
    left(coalesce(v_row ->> 'error_code', v_row ->> 'failed_reason', v_status_raw), 160),
    left(coalesce(v_row ->> 'idempotency_key', v_row ->> 'operation_key'), 300),
    v_related,
    jsonb_strip_nulls(jsonb_build_object(
      'databaseOperation', tg_op,
      'previousStatus', case when tg_op = 'UPDATE' then to_jsonb(old) ->> 'status' end,
      'currentStatus', case when tg_op <> 'DELETE' then to_jsonb(new) ->> 'status' end
    )),
    current_setting('app.deployment_sha', true)
  );
  return case when tg_op = 'DELETE' then old else new end;
exception when others then
  -- Common operations remain available; the runtime health reconciler detects gaps.
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.capture_operational_table_change_v1() from public, anon, authenticated;
grant execute on function public.capture_operational_table_change_v1() to service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'admin_users','tenant_agents','lead_distribution_rules','leads','lead_journeys',
    'lead_redistribution_jobs','conversation_states','conversation_events','whatsapp_messages',
    'agent_response_jobs','agent_outbound_outbox','follow_up_jobs','agent_followup_events',
    'agenda_events','agenda_mutation_operations','agent_agenda_pending_actions',
    'agenda_notification_outbox','agenda_sync_outbox','agenda_reminder_jobs_v2',
    'evolution_webhook_inbox','meta_lead_events','whatsapp_cloud_connections',
    'whatsapp_campaigns','whatsapp_campaign_recipients','external_api_call_logs',
    'external_api_connectors','stripe_subscriptions','tenant_billing_entitlements'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists operational_audit_capture on public.%I', v_table);
      execute format(
        'create trigger operational_audit_capture after insert or update or delete on public.%I for each row execute function public.capture_operational_table_change_v1()',
        v_table
      );
    end if;
  end loop;
end;
$$;

create or replace function public.get_operational_audit_health_v1()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with state as (
    select
      (select max(occurred_at) from public.operational_audit_events where module = 'runtime.watchdog' and action in ('check.started','check.completed')) as watchdog_at,
      -- Generic table-change events do not represent a claimable job lifecycle.
      -- Only durable jobs with a correlated source row can be declared stale.
      (select count(*) from public.operational_audit_exports where status in ('pending','processing') and created_at < now() - interval '10 minutes') as stale_operations,
      (select count(*) from public.operational_audit_exports where status in ('pending','processing') and created_at < now() - interval '10 minutes') as stale_exports,
      (select count(*) from public.operational_audit_exports where status = 'failed' and created_at >= now() - interval '24 hours') as failed_exports,
      (select count(*) from public.operational_audit_archives where status = 'processing' and updated_at < now() - interval '30 minutes') as stale_archives,
      (select count(*) from public.operational_audit_archives where status = 'failed' and updated_at >= now() - interval '24 hours') as failed_archives
  )
  select jsonb_build_object(
    'version', 1,
    'status', case
      when watchdog_at is null or watchdog_at < now() - interval '10 minutes'
        or stale_operations > 0 or stale_exports > 0 or stale_archives > 0 or failed_archives > 0
        then 'unhealthy' else 'healthy' end,
    'watchdogLastObservedAt', watchdog_at,
    'watchdogAgeSeconds', case when watchdog_at is null then null else extract(epoch from now() - watchdog_at)::integer end,
    'staleOperations', stale_operations,
    'staleExports', stale_exports,
    'failedExportsLast24Hours', failed_exports,
    'staleArchives', stale_archives,
    'failedArchivesLast24Hours', failed_archives
  ) from state;
$$;
revoke all on function public.get_operational_audit_health_v1() from public, anon, authenticated;
grant execute on function public.get_operational_audit_health_v1() to service_role;

create or replace function public.expire_operational_audit_exports_v1()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  update public.operational_audit_exports
  set status = 'expired', payload = null
  where status = 'completed'
    and expires_at is not null
    and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.expire_operational_audit_exports_v1() from public, anon, authenticated;
grant execute on function public.expire_operational_audit_exports_v1() to service_role;

create or replace function public.run_operational_audit_maintenance_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expired integer;
begin
  perform public.ensure_operational_audit_partitions_v1(now());
  perform public.summarize_operational_audit_month_v1(
    (date_trunc('month', now()) - interval '1 month')::date
  );
  v_expired := public.expire_operational_audit_exports_v1();
  return jsonb_build_object('status', 'completed', 'expiredExports', v_expired, 'ranAt', now());
end;
$$;
revoke all on function public.run_operational_audit_maintenance_v1() from public, anon, authenticated;
grant execute on function public.run_operational_audit_maintenance_v1() to service_role;

do $audit_cron$
declare
  v_job bigint;
begin
  if to_regnamespace('cron') is null then return; end if;
  for v_job in select jobid from cron.job where jobname = 'mychatcrm-operational-audit-hourly'
  loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule(
    'mychatcrm-operational-audit-hourly',
    '17 * * * *',
    'select public.run_operational_audit_maintenance_v1();'
  );
end;
$audit_cron$;

-- Defensive explicit grants for projects where new tables are not auto-exposed.
grant usage on schema public to service_role;
