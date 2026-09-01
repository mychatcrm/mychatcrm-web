-- Make operation summaries represent the latest state of each durable resource.
-- The immutable event ledger remains untouched.

create schema if not exists private;

create or replace function private.operational_audit_resource_operation_id_v1(
  p_resource_type text,
  p_resource_id text
)
returns uuid
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select (
    substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-' ||
    substr(v_hash, 13, 4) || '-' || substr(v_hash, 17, 4) || '-' ||
    substr(v_hash, 21, 12)
  )::uuid
  from (
    select md5('mychatcrm:operational-audit:' || p_resource_type || ':' || p_resource_id) as v_hash
  ) hashed;
$$;

revoke all on function private.operational_audit_resource_operation_id_v1(text, text)
  from public, anon, authenticated;
grant execute on function private.operational_audit_resource_operation_id_v1(text, text)
  to service_role;

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
    module = excluded.module,
    action = excluded.action,
    resource_type = coalesce(excluded.resource_type, public.operational_audit_operations.resource_type),
    resource_id = coalesce(excluded.resource_id, public.operational_audit_operations.resource_id),
    status = excluded.status,
    severity = excluded.severity,
    is_critical = public.operational_audit_operations.is_critical or excluded.is_critical,
    actor_type = excluded.actor_type,
    actor_id = coalesce(excluded.actor_id, public.operational_audit_operations.actor_id),
    channel = coalesce(excluded.channel, public.operational_audit_operations.channel),
    integration = coalesce(excluded.integration, public.operational_audit_operations.integration),
    updated_at = excluded.updated_at,
    completed_at = case
      when excluded.status in ('completed','blocked','cancelled','error') then excluded.updated_at
      else null
    end,
    duration_ms = coalesce(excluded.duration_ms, public.operational_audit_operations.duration_ms),
    result_code = coalesce(excluded.result_code, public.operational_audit_operations.result_code),
    event_count = public.operational_audit_operations.event_count + 1,
    deployment_sha = coalesce(excluded.deployment_sha, public.operational_audit_operations.deployment_sha);
  return new;
end;
$$;

create or replace function public.capture_operational_table_change_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_status_raw text := lower(coalesce(v_row ->> 'status', 'completed'));
  v_status text;
  v_severity text := 'info';
  v_resource_id text := coalesce(v_row ->> 'id', v_row ->> 'event_id', v_row ->> 'job_id');
  v_tenant_id text := v_row ->> 'tenant_id';
  v_related jsonb := '{}'::jsonb;
  v_operation uuid;
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
  v_operation := case
    when v_resource_id is null then gen_random_uuid()
    else private.operational_audit_resource_operation_id_v1(tg_table_name, v_resource_id)
  end;

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
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.capture_operational_table_change_v1()
  from public, anon, authenticated;
grant execute on function public.capture_operational_table_change_v1()
  to service_role;

-- The operation table is a derived cache. Rebuild only rows created by the
-- generic database trigger; immutable events and explicit operations remain.
delete from public.operational_audit_operations operation
using public.operational_audit_events event
where operation.operation_id = event.operation_id
  and event.metadata ? 'databaseOperation';

with captured as (
  select
    event.*,
    private.operational_audit_resource_operation_id_v1(event.resource_type, event.resource_id) as derived_operation_id
  from public.operational_audit_events event
  where event.metadata ? 'databaseOperation'
    and event.resource_type is not null
    and event.resource_id is not null
), aggregates as (
  select
    derived_operation_id,
    min(occurred_at) as started_at,
    max(occurred_at) as updated_at,
    count(*)::integer as event_count,
    bool_or(is_critical) as is_critical
  from captured
  group by derived_operation_id
), latest as (
  select distinct on (derived_operation_id)
    derived_operation_id, trace_id, tenant_id, module, action, resource_type,
    resource_id, status, severity, actor_type, actor_id, channel, integration,
    occurred_at, duration_ms, result_code, deployment_sha
  from captured
  order by derived_operation_id, occurred_at desc, id desc
)
insert into public.operational_audit_operations (
  operation_id, trace_id, tenant_id, module, action, resource_type, resource_id,
  status, severity, is_critical, actor_type, actor_id, channel, integration,
  started_at, updated_at, completed_at, duration_ms, result_code, event_count,
  deployment_sha
)
select
  latest.derived_operation_id, latest.trace_id, latest.tenant_id, latest.module,
  latest.action, latest.resource_type, latest.resource_id, latest.status,
  latest.severity, aggregates.is_critical, latest.actor_type, latest.actor_id,
  latest.channel, latest.integration, aggregates.started_at, aggregates.updated_at,
  case when latest.status in ('completed','blocked','cancelled','error') then aggregates.updated_at end,
  latest.duration_ms, latest.result_code, aggregates.event_count, latest.deployment_sha
from latest
join aggregates using (derived_operation_id)
on conflict (operation_id) do nothing;

-- Old watchdog starts used a fresh operation id for each phase. Remove only
-- their obsolete derived summaries when the corresponding completion exists.
delete from public.operational_audit_operations operation
using public.operational_audit_events started
where operation.operation_id = started.operation_id
  and started.module = 'runtime.watchdog'
  and started.action = 'check.started'
  and exists (
    select 1
    from public.operational_audit_events completed
    where completed.module = 'runtime.watchdog'
      and completed.action = 'check.completed'
      and completed.related_ids ->> 'github_run_id' = started.related_ids ->> 'github_run_id'
  );

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
    from public.operational_audit_operations
    where updated_at >= p_from and updated_at < p_to
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

revoke all on function public.get_operational_audit_dashboard_v1(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_operational_audit_dashboard_v1(timestamptz, timestamptz)
  to service_role;

create or replace function public.get_operational_audit_health_v1()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with state as (
    select
      (select max(occurred_at) from public.operational_audit_events where module = 'runtime.watchdog' and action in ('check.started','check.completed')) as watchdog_at,
      (select count(*) from public.operational_audit_operations
       where status in ('pending','running')
         and updated_at < now() - interval '10 minutes'
         and module in ('admin.audit','runtime.watchdog')) as stale_operations,
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

revoke all on function public.get_operational_audit_health_v1()
  from public, anon, authenticated;
grant execute on function public.get_operational_audit_health_v1()
  to service_role;

