-- Agent runtime certification: service-only health, aggregate metrics,
-- tenant/subsystem kill switches and pg_net privilege hardening.
--
-- This migration is additive. Existing jobs, alerts and confirmed agenda
-- events are neither replayed nor modified.

create schema if not exists private;

-- Runtime always supplies the agent's explicit IANA timezone. Removing this
-- legacy default prevents a missing configuration from being silently treated
-- as one country. Existing pending actions are intentionally left untouched.
alter table public.agent_agenda_pending_actions
  alter column timezone drop default;

do $agenda_timezone_constraint$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.agent_agenda_pending_actions'::regclass
       and conname = 'agent_agenda_pending_actions_timezone_nonempty_check'
  ) then
    alter table public.agent_agenda_pending_actions
      add constraint agent_agenda_pending_actions_timezone_nonempty_check
      check (nullif(btrim(timezone), '') is not null) not valid;
  end if;

  if not exists (
    select 1
      from public.agent_agenda_pending_actions
     where nullif(btrim(timezone), '') is null
  ) then
    alter table public.agent_agenda_pending_actions
      validate constraint agent_agenda_pending_actions_timezone_nonempty_check;
  end if;
end;
$agenda_timezone_constraint$;

create table if not exists private.agent_runtime_subsystem_controls (
  tenant_id text not null references public.tenants(id) on delete cascade,
  subsystem text not null
    check (subsystem in ('agenda', 'agenda_reminder', 'follow_up')),
  mode text not null default 'enabled'
    check (mode in ('enabled', 'shadow', 'disabled')),
  reason_code text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, subsystem)
);

revoke all on table private.agent_runtime_subsystem_controls
  from public, anon, authenticated;
grant select, insert, update, delete
  on table private.agent_runtime_subsystem_controls to service_role;

create or replace function public.get_agent_runtime_subsystem_control_v1(
  p_tenant_id text,
  p_subsystem text
)
returns table (
  subsystem text,
  mode text,
  enabled boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_tenant_id), '') is null
     or p_subsystem not in ('agenda', 'agenda_reminder', 'follow_up') then
    raise exception 'agent_runtime_subsystem_control_invalid';
  end if;

  return query
  select c.subsystem, c.mode, c.mode <> 'disabled', c.updated_at
    from private.agent_runtime_subsystem_controls c
   where c.tenant_id = p_tenant_id
     and c.subsystem = p_subsystem;

  if not found then
    -- Compatibility-preserving default: a tenant is unaffected until an
    -- operator explicitly activates a kill switch.
    return query
    select p_subsystem, 'enabled'::text, true, null::timestamptz;
  end if;
end;
$$;

revoke all on function public.get_agent_runtime_subsystem_control_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.get_agent_runtime_subsystem_control_v1(text, text)
  to service_role;

create or replace function public.set_agent_runtime_subsystem_control_v1(
  p_tenant_id text,
  p_subsystem text,
  p_mode text,
  p_reason_code text default null,
  p_updated_by text default null
)
returns table (
  subsystem text,
  mode text,
  enabled boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_tenant_id), '') is null
     or p_subsystem not in ('agenda', 'agenda_reminder', 'follow_up')
     or p_mode not in ('enabled', 'shadow', 'disabled') then
    raise exception 'agent_runtime_subsystem_control_invalid';
  end if;

  insert into private.agent_runtime_subsystem_controls(
    tenant_id, subsystem, mode, reason_code, updated_by, updated_at
  ) values (
    p_tenant_id,
    p_subsystem,
    p_mode,
    nullif(left(btrim(coalesce(p_reason_code, '')), 120), ''),
    nullif(left(btrim(coalesce(p_updated_by, '')), 120), ''),
    now()
  )
  on conflict (tenant_id, subsystem) do update
    set mode = excluded.mode,
        reason_code = excluded.reason_code,
        updated_by = excluded.updated_by,
        updated_at = now();

  return query
  select c.subsystem, c.mode, c.mode <> 'disabled', c.updated_at
    from private.agent_runtime_subsystem_controls c
   where c.tenant_id = p_tenant_id
     and c.subsystem = p_subsystem;
end;
$$;

revoke all on function public.set_agent_runtime_subsystem_control_v1(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_agent_runtime_subsystem_control_v1(text, text, text, text, text)
  to service_role;

create table if not exists private.agent_runtime_health_heartbeats (
  component text primary key,
  status text not null default 'ok'
    check (status in ('ok', 'degraded', 'failed')),
  observed_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

revoke all on table private.agent_runtime_health_heartbeats
  from public, anon, authenticated;
grant select, insert, update, delete
  on table private.agent_runtime_health_heartbeats to service_role;

insert into private.agent_runtime_health_heartbeats(component, status, observed_at, details)
values ('certification_health_v1', 'ok', now(), jsonb_build_object('version', 1))
on conflict (component) do nothing;

create table if not exists private.agent_runtime_queue_metrics_minute (
  bucket_start timestamptz not null,
  queue text not null
    check (queue in ('agent_response', 'evolution_inbox', 'follow_up', 'agenda_reminder', 'outbox')),
  pending_count bigint not null default 0 check (pending_count >= 0),
  processing_count bigint not null default 0 check (processing_count >= 0),
  overdue_count bigint not null default 0 check (overdue_count >= 0),
  expired_claim_count bigint not null default 0 check (expired_claim_count >= 0),
  terminal_failure_count bigint not null default 0 check (terminal_failure_count >= 0),
  recorded_at timestamptz not null default now(),
  primary key (bucket_start, queue)
);

revoke all on table private.agent_runtime_queue_metrics_minute
  from public, anon, authenticated;
grant select, insert, update, delete
  on table private.agent_runtime_queue_metrics_minute to service_role;

create table if not exists private.agent_runtime_metrics_minute (
  bucket_start timestamptz not null,
  metric_name text not null
    check (metric_name in (
      'runtime_health_check', 'webhook_latency', 'provider_call',
      'agenda_action', 'follow_up', 'agenda_reminder',
      'authorization', 'retry', 'duplicate'
    )),
  subsystem text not null
    check (subsystem in (
      'runtime', 'evolution', 'meta_cloud', 'agenda',
      'agenda_reminder', 'follow_up', 'outbox', 'external_api'
    )),
  outcome text not null
    check (outcome in (
      'success', 'blocked', 'retry', 'duplicate', 'failed',
      'pending', 'sent', 'cancelled'
    )),
  event_count bigint not null default 0 check (event_count >= 0),
  duration_sample_count bigint not null default 0 check (duration_sample_count >= 0),
  duration_sum_ms bigint not null default 0 check (duration_sum_ms >= 0),
  duration_max_ms integer not null default 0 check (duration_max_ms >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_start, metric_name, subsystem, outcome)
);

revoke all on table private.agent_runtime_metrics_minute
  from public, anon, authenticated;
grant select, insert, update, delete
  on table private.agent_runtime_metrics_minute to service_role;

create or replace function public.record_agent_runtime_metric_v1(
  p_metric_name text,
  p_subsystem text,
  p_outcome text,
  p_duration_ms integer default null,
  p_count integer default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket timestamptz := date_trunc('minute', now());
  v_count integer := greatest(1, least(coalesce(p_count, 1), 100000));
  v_duration integer := case
    when p_duration_ms is null then null
    else greatest(0, least(p_duration_ms, 3600000))
  end;
begin
  if p_metric_name not in (
       'runtime_health_check', 'webhook_latency', 'provider_call',
       'agenda_action', 'follow_up', 'agenda_reminder',
       'authorization', 'retry', 'duplicate'
     )
     or p_subsystem not in (
       'runtime', 'evolution', 'meta_cloud', 'agenda',
       'agenda_reminder', 'follow_up', 'outbox', 'external_api'
     )
     or p_outcome not in (
       'success', 'blocked', 'retry', 'duplicate', 'failed',
       'pending', 'sent', 'cancelled'
     ) then
    raise exception 'agent_runtime_metric_invalid';
  end if;

  insert into private.agent_runtime_metrics_minute(
    bucket_start, metric_name, subsystem, outcome,
    event_count, duration_sample_count, duration_sum_ms, duration_max_ms
  ) values (
    v_bucket, p_metric_name, p_subsystem, p_outcome,
    v_count,
    case when v_duration is null then 0 else v_count end,
    case when v_duration is null then 0 else v_duration::bigint * v_count end,
    coalesce(v_duration, 0)
  )
  on conflict (bucket_start, metric_name, subsystem, outcome) do update
    set event_count = private.agent_runtime_metrics_minute.event_count + excluded.event_count,
        duration_sample_count = private.agent_runtime_metrics_minute.duration_sample_count + excluded.duration_sample_count,
        duration_sum_ms = private.agent_runtime_metrics_minute.duration_sum_ms + excluded.duration_sum_ms,
        duration_max_ms = greatest(private.agent_runtime_metrics_minute.duration_max_ms, excluded.duration_max_ms),
        updated_at = now();
end;
$$;

revoke all on function public.record_agent_runtime_metric_v1(text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_agent_runtime_metric_v1(text, text, text, integer, integer)
  to service_role;

create or replace function private.record_agent_runtime_queue_metrics_v1()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket timestamptz := date_trunc('minute', now());
begin
  insert into private.agent_runtime_queue_metrics_minute(
    bucket_start, queue, pending_count, processing_count, overdue_count,
    expired_claim_count, terminal_failure_count, recorded_at
  )
  select v_bucket, 'agent_response',
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'processing'),
         count(*) filter (where status = 'pending' and scheduled_for < now() - interval '5 minutes'),
         count(*) filter (where status = 'processing' and claim_expires_at < now()),
         count(*) filter (where status = 'failed' and updated_at >= now() - interval '24 hours'),
         now()
    from public.agent_response_jobs
  union all
  select v_bucket, 'evolution_inbox',
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'processing'),
         count(*) filter (where status = 'pending' and next_attempt_at < now() - interval '3 minutes'),
         count(*) filter (where status = 'processing' and claim_expires_at < now()),
         count(*) filter (where status = 'dead_letter' and updated_at >= now() - interval '24 hours'),
         now()
    from public.evolution_webhook_inbox
  union all
  select v_bucket, 'follow_up',
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'processing'),
         count(*) filter (where status = 'pending' and scheduled_at < now() - interval '5 minutes'),
         count(*) filter (where status = 'processing' and claim_expires_at < now()),
         count(*) filter (where status = 'exhausted' and updated_at >= now() - interval '24 hours'),
         now()
    from public.follow_up_jobs
  union all
  select v_bucket, 'agenda_reminder',
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'processing'),
         count(*) filter (where status = 'pending' and next_attempt_at < now() - interval '5 minutes'),
         count(*) filter (where status = 'processing' and claim_expires_at < now()),
         count(*) filter (where status = 'exhausted' and updated_at >= now() - interval '24 hours'),
         now()
    from public.agenda_reminder_jobs_v2
  union all
  select v_bucket, 'outbox',
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'processing'),
         count(*) filter (where status = 'pending' and next_attempt_at < now() - interval '5 minutes'),
         count(*) filter (where status = 'processing' and claim_expires_at < now()),
         count(*) filter (where status in ('failed', 'ambiguous') and updated_at >= now() - interval '24 hours'),
         now()
    from public.agent_outbound_outbox
  on conflict (bucket_start, queue) do update
    set pending_count = excluded.pending_count,
        processing_count = excluded.processing_count,
        overdue_count = excluded.overdue_count,
        expired_claim_count = excluded.expired_claim_count,
        terminal_failure_count = excluded.terminal_failure_count,
        recorded_at = now();

  delete from private.agent_runtime_queue_metrics_minute
   where bucket_start < now() - interval '30 days';
  delete from private.agent_runtime_metrics_minute
   where bucket_start < now() - interval '30 days';
end;
$$;

revoke all on function private.record_agent_runtime_queue_metrics_v1()
  from public, anon, authenticated;
grant execute on function private.record_agent_runtime_queue_metrics_v1()
  to service_role;

create or replace function private.monitor_agent_runtime_v4()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.agent_runtime_health_heartbeats(component, status, observed_at, details)
  values ('agent_runtime_monitor', 'ok', now(), jsonb_build_object('version', 4, 'phase', 'started'))
  on conflict (component) do update
    set status = 'ok', observed_at = now(), details = excluded.details;

  perform private.monitor_agent_runtime_v3();
  perform private.record_agent_runtime_queue_metrics_v1();

  update private.agent_runtime_health_heartbeats
     set status = 'ok', observed_at = now(), details = jsonb_build_object('version', 4, 'phase', 'completed')
   where component = 'agent_runtime_monitor';
exception when others then
  insert into private.agent_runtime_health_heartbeats(component, status, observed_at, details)
  values ('agent_runtime_monitor', 'failed', now(), jsonb_build_object('version', 4, 'phase', 'failed'))
  on conflict (component) do update
    set status = 'failed', observed_at = now(), details = excluded.details;
  raise;
end;
$$;

revoke all on function private.monitor_agent_runtime_v4()
  from public, anon, authenticated;
grant execute on function private.monitor_agent_runtime_v4() to service_role;

create or replace function public.get_agent_runtime_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_activation_at timestamptz;
  v_monitor_at timestamptz;
  v_monitor_status text;
  v_monitor_age_seconds bigint;
  v_response_overdue bigint;
  v_response_expired bigint;
  v_evolution_overdue bigint;
  v_evolution_expired bigint;
  v_follow_up_overdue bigint;
  v_follow_up_expired bigint;
  v_reminder_overdue bigint;
  v_reminder_expired bigint;
  v_outbox_overdue bigint;
  v_outbox_expired bigint;
  v_terminal_failures bigint;
  v_critical_open bigint;
  v_warning_open bigint;
  v_scheduler_failures bigint;
  v_agenda_dispatch_at timestamptz;
  v_evolution_dispatch_at timestamptz;
  v_follow_up_dispatch_at timestamptz;
  v_scheduler_stale bigint := 0;
  v_reasons text[] := array[]::text[];
begin
  select observed_at into v_activation_at
    from private.agent_runtime_health_heartbeats
   where component = 'certification_health_v1';
  v_activation_at := coalesce(v_activation_at, v_now);

  select observed_at, status into v_monitor_at, v_monitor_status
    from private.agent_runtime_health_heartbeats
   where component = 'agent_runtime_monitor';
  v_monitor_age_seconds := case
    when v_monitor_at is null then null
    else greatest(0, extract(epoch from (v_now - v_monitor_at))::bigint)
  end;

  select
    count(*) filter (where status = 'pending' and scheduled_for < v_now - interval '5 minutes'),
    count(*) filter (where status = 'processing' and claim_expires_at < v_now)
  into v_response_overdue, v_response_expired
  from public.agent_response_jobs;

  select
    count(*) filter (where status = 'pending' and next_attempt_at < v_now - interval '3 minutes'),
    count(*) filter (where status = 'processing' and claim_expires_at < v_now)
  into v_evolution_overdue, v_evolution_expired
  from public.evolution_webhook_inbox;

  select
    count(*) filter (where status = 'pending' and scheduled_at < v_now - interval '5 minutes'),
    count(*) filter (where status = 'processing' and claim_expires_at < v_now)
  into v_follow_up_overdue, v_follow_up_expired
  from public.follow_up_jobs;

  select
    count(*) filter (where status = 'pending' and next_attempt_at < v_now - interval '5 minutes'),
    count(*) filter (where status = 'processing' and claim_expires_at < v_now)
  into v_reminder_overdue, v_reminder_expired
  from public.agenda_reminder_jobs_v2;

  select
    count(*) filter (where status = 'pending' and next_attempt_at < v_now - interval '5 minutes'),
    count(*) filter (where status = 'processing' and claim_expires_at < v_now)
  into v_outbox_overdue, v_outbox_expired
  from public.agent_outbound_outbox;

  -- Terminal rows remain as immutable audit evidence. Treat only newly-created
  -- failures as an active incident; otherwise a single resolved provider error
  -- would keep the external watchdog unhealthy forever. Persistent incidents
  -- remain visible through open runtime alerts and repeated fresh failures.
  select
    (select count(*) from public.agent_response_jobs where status = 'failed' and updated_at >= v_now - interval '15 minutes')
    + (select count(*) from public.evolution_webhook_inbox where status = 'dead_letter' and updated_at >= v_now - interval '15 minutes')
    + (select count(*) from public.follow_up_jobs where status = 'exhausted' and updated_at >= v_now - interval '15 minutes')
    + (select count(*) from public.agenda_reminder_jobs_v2 where status = 'exhausted' and updated_at >= v_now - interval '15 minutes')
    + (select count(*) from public.agent_outbound_outbox where status in ('failed', 'ambiguous') and updated_at >= v_now - interval '15 minutes')
  into v_terminal_failures;

  select count(*) filter (where severity = 'critical'),
         count(*) filter (where severity = 'warning')
    into v_critical_open, v_warning_open
    from public.agent_runtime_alerts
   where status = 'open';

  select max(dispatched_at) filter (where queue = 'agenda_reminders'),
         max(dispatched_at) filter (where queue = 'evolution_inbox'),
         count(*) filter (
           where dispatched_at >= v_now - interval '5 minutes'
             and status in ('config_missing', 'request_failed')
         )
    into v_agenda_dispatch_at, v_evolution_dispatch_at, v_scheduler_failures
    from private.agent_runtime_scheduler_dispatches;

  select max(dispatched_at),
         v_scheduler_failures + count(*) filter (
           where dispatched_at >= v_now - interval '5 minutes'
             and status in ('config_missing', 'request_failed')
         )
    into v_follow_up_dispatch_at, v_scheduler_failures
    from private.follow_up_scheduler_dispatches;

  if v_now - v_activation_at > interval '3 minutes' then
    if v_agenda_dispatch_at is null or v_agenda_dispatch_at < v_now - interval '3 minutes' then
      v_scheduler_stale := v_scheduler_stale + 1;
    end if;
    if v_evolution_dispatch_at is null or v_evolution_dispatch_at < v_now - interval '3 minutes' then
      v_scheduler_stale := v_scheduler_stale + 1;
    end if;
    if v_follow_up_dispatch_at is null or v_follow_up_dispatch_at < v_now - interval '3 minutes' then
      v_scheduler_stale := v_scheduler_stale + 1;
    end if;
  end if;

  if v_monitor_at is null or v_monitor_status <> 'ok' or v_monitor_at < v_now - interval '3 minutes' then
    v_reasons := array_append(v_reasons, 'runtime_monitor_stale');
  end if;
  if coalesce(v_scheduler_stale, 0) > 0 then
    v_reasons := array_append(v_reasons, 'scheduler_stale');
  end if;
  if coalesce(v_scheduler_failures, 0) > 0 then
    v_reasons := array_append(v_reasons, 'scheduler_dispatch_failed');
  end if;
  if coalesce(v_response_overdue, 0) + coalesce(v_evolution_overdue, 0)
     + coalesce(v_follow_up_overdue, 0) + coalesce(v_reminder_overdue, 0)
     + coalesce(v_outbox_overdue, 0) > 0 then
    v_reasons := array_append(v_reasons, 'queue_backlog');
  end if;
  if coalesce(v_response_expired, 0) + coalesce(v_evolution_expired, 0)
     + coalesce(v_follow_up_expired, 0) + coalesce(v_reminder_expired, 0)
     + coalesce(v_outbox_expired, 0) > 0 then
    v_reasons := array_append(v_reasons, 'claim_expired');
  end if;
  if coalesce(v_terminal_failures, 0) > 0 then
    v_reasons := array_append(v_reasons, 'terminal_failure');
  end if;
  if coalesce(v_critical_open, 0) > 0 then
    v_reasons := array_append(v_reasons, 'critical_alert_open');
  end if;

  return jsonb_build_object(
    'version', 1,
    'generatedAt', v_now,
    'status', case when cardinality(v_reasons) = 0 then 'healthy' else 'unhealthy' end,
    'reasons', to_jsonb(v_reasons),
    'heartbeat', jsonb_build_object(
      'monitorObservedAt', v_monitor_at,
      'monitorAgeSeconds', v_monitor_age_seconds,
      'monitorStatus', coalesce(v_monitor_status, 'missing')
    ),
    'schedulers', jsonb_build_object(
      'staleCount', coalesce(v_scheduler_stale, 0),
      'failuresLast5Minutes', coalesce(v_scheduler_failures, 0),
      'agendaReminderLastDispatchAt', v_agenda_dispatch_at,
      'evolutionInboxLastDispatchAt', v_evolution_dispatch_at,
      'followUpLastDispatchAt', v_follow_up_dispatch_at
    ),
    'queues', jsonb_build_object(
      'agentResponse', jsonb_build_object('overdue', coalesce(v_response_overdue, 0), 'expiredClaims', coalesce(v_response_expired, 0)),
      'evolutionInbox', jsonb_build_object('overdue', coalesce(v_evolution_overdue, 0), 'expiredClaims', coalesce(v_evolution_expired, 0)),
      'followUp', jsonb_build_object('overdue', coalesce(v_follow_up_overdue, 0), 'expiredClaims', coalesce(v_follow_up_expired, 0)),
      'agendaReminder', jsonb_build_object('overdue', coalesce(v_reminder_overdue, 0), 'expiredClaims', coalesce(v_reminder_expired, 0)),
      'outbox', jsonb_build_object('overdue', coalesce(v_outbox_overdue, 0), 'expiredClaims', coalesce(v_outbox_expired, 0)),
      'terminalFailuresSinceActivation', coalesce(v_terminal_failures, 0)
    ),
    'alerts', jsonb_build_object(
      'criticalOpen', coalesce(v_critical_open, 0),
      'warningOpen', coalesce(v_warning_open, 0)
    )
  );
end;
$$;

revoke all on function public.get_agent_runtime_health_v1()
  from public, anon, authenticated;
grant execute on function public.get_agent_runtime_health_v1() to service_role;

-- pg_net is non-relocatable in the active project and has dependent objects.
-- Keep it in place; close public access around the existing net schema instead.
do $pg_net_hardening$
declare
  v_proc regprocedure;
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    execute 'revoke all on schema net from public, anon, authenticated';
    execute 'grant usage on schema net to service_role';
    execute 'revoke all privileges on all tables in schema net from public, anon, authenticated';
    execute 'revoke all privileges on all sequences in schema net from public, anon, authenticated';

    for v_proc in
      select p.oid::regprocedure
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'net'
    loop
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_proc
      );
      execute format('grant execute on function %s to service_role', v_proc);
    end loop;
  end if;
end;
$pg_net_hardening$;

-- Replace only the monitor command; queue schedulers are left untouched.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'mychatcrm-agent-runtime-monitor-minute';

select cron.schedule(
  'mychatcrm-agent-runtime-monitor-minute',
  '* * * * *',
  $$select private.monitor_agent_runtime_v4();$$
);

-- Initialize the heartbeat and first aggregate bucket immediately.
select private.monitor_agent_runtime_v4();
