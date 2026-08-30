-- Runtime monitor must distinguish a future obligation from an overdue one.
-- It also resolves its own queue alerts after recovery instead of leaving a
-- stale warning open forever.

create or replace function private.set_agent_runtime_queue_alert_v3(
  p_code text,
  p_severity text,
  p_count bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text := 'global:' || p_code || ':open';
begin
  if p_count > 0 then
    insert into public.agent_runtime_alerts(
      code,severity,resource_type,details,fingerprint,status,last_seen_at
    ) values (
      p_code,p_severity,'queue',jsonb_build_object('count',p_count),v_fingerprint,'open',now()
    )
    on conflict(fingerprint,status) do update
      set last_seen_at=now(),details=excluded.details,severity=excluded.severity,resolved_at=null;
    return;
  end if;

  -- Keep only the latest resolved copy so the unique(fingerprint,status)
  -- contract can safely transition a later incident from open to resolved.
  delete from public.agent_runtime_alerts
   where fingerprint=v_fingerprint and status='resolved';
  update public.agent_runtime_alerts
     set status='resolved',resolved_at=now(),last_seen_at=now(),details='{"count":0}'::jsonb
   where fingerprint=v_fingerprint and status='open';
end;
$$;

revoke all on function private.set_agent_runtime_queue_alert_v3(text,text,bigint)
  from public,anon,authenticated;
grant execute on function private.set_agent_runtime_queue_alert_v3(text,text,bigint)
  to service_role;

create or replace function private.monitor_agent_runtime_v3()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.evolution_webhook_inbox
   where status='pending' and created_at<now()-interval '3 minutes';
  perform private.set_agent_runtime_queue_alert_v3(
    'evolution_inbox_backlog',
    case when v_count>50 then 'critical' else 'warning' end,
    v_count
  );

  select count(*) into v_count
    from public.follow_up_jobs
   where status='processing' and claim_expires_at<now();
  perform private.set_agent_runtime_queue_alert_v3('follow_up_claims_expired','warning',v_count);

  select count(*) into v_count
    from public.agenda_reminder_jobs_v2
   where status='processing' and claim_expires_at<now();
  perform private.set_agent_runtime_queue_alert_v3('agenda_reminder_claims_expired','warning',v_count);

  -- Production has scheduled_at. The fallback keeps a legacy/local schema
  -- observable without weakening the due-time check used in production.
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='follow_up_jobs' and column_name='scheduled_at'
  ) then
    execute $sql$
      select count(*) from public.follow_up_jobs
       where status='pending' and scheduled_at<now()-interval '5 minutes'
    $sql$ into v_count;
  else
    select count(*) into v_count
      from public.follow_up_jobs
     where status='pending' and updated_at<now()-interval '5 minutes';
  end if;
  perform private.set_agent_runtime_queue_alert_v3('follow_up_backlog','warning',v_count);

  select count(*) into v_count
    from private.agent_runtime_scheduler_dispatches
   where dispatched_at>now()-interval '5 minutes'
     and status in ('config_missing','request_failed');
  perform private.set_agent_runtime_queue_alert_v3('agent_runtime_scheduler_failure','critical',v_count);
end;
$$;

revoke all on function private.monitor_agent_runtime_v3()
  from public,anon,authenticated;
grant execute on function private.monitor_agent_runtime_v3() to service_role;

-- Reconcile stale alerts immediately; the cron continues every minute.
select private.monitor_agent_runtime_v3();
