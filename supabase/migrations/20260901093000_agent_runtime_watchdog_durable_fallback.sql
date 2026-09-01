-- Durable five-minute fallback for the external GitHub watchdog.
-- It uses the existing Vault HMAC secret and never reads customer data.

create table if not exists private.agent_runtime_watchdog_state_v1 (
  singleton boolean primary key default true check (singleton),
  current_status text not null default 'unknown' check (current_status in ('unknown','healthy','unhealthy')),
  incident_started_at timestamptz,
  last_failure_alert_at timestamptz,
  last_recovery_at timestamptz,
  last_checked_at timestamptz,
  last_source text
);

alter table private.agent_runtime_watchdog_state_v1 enable row level security;
revoke all on table private.agent_runtime_watchdog_state_v1 from public, anon, authenticated;
grant select, insert, update on table private.agent_runtime_watchdog_state_v1 to service_role;

insert into private.agent_runtime_watchdog_state_v1(singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.record_agent_runtime_watchdog_probe_v1(
  p_healthy boolean,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row private.agent_runtime_watchdog_state_v1%rowtype;
  v_notification text;
  v_now timestamptz := clock_timestamp();
begin
  if p_source not in ('supabase_pg_cron','github_actions') then
    raise exception 'watchdog_source_invalid';
  end if;

  select * into v_row
  from private.agent_runtime_watchdog_state_v1
  where singleton = true
  for update;

  if p_healthy then
    if v_row.current_status = 'unhealthy' then
      v_notification := 'recovery';
    end if;
    update private.agent_runtime_watchdog_state_v1
       set current_status = 'healthy',
           incident_started_at = null,
           last_recovery_at = case when v_notification = 'recovery' then v_now else last_recovery_at end,
           last_checked_at = v_now,
           last_source = p_source
     where singleton = true;
  else
    if v_row.current_status <> 'unhealthy' then
      v_notification := 'failure';
    elsif v_row.last_failure_alert_at is null
       or v_row.last_failure_alert_at <= v_now - interval '1 hour' then
      v_notification := 'repeat';
    end if;
    update private.agent_runtime_watchdog_state_v1
       set current_status = 'unhealthy',
           incident_started_at = coalesce(incident_started_at, v_now),
           last_failure_alert_at = case when v_notification is not null then v_now else last_failure_alert_at end,
           last_checked_at = v_now,
           last_source = p_source
     where singleton = true;
  end if;

  return jsonb_build_object(
    'status', case when p_healthy then 'healthy' else 'unhealthy' end,
    'notification', v_notification,
    'checkedAt', v_now
  );
end;
$$;

revoke all on function public.record_agent_runtime_watchdog_probe_v1(boolean,text)
  from public, anon, authenticated;
grant execute on function public.record_agent_runtime_watchdog_probe_v1(boolean,text)
  to service_role;

create or replace function private.dispatch_agent_runtime_watchdog_tick_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path constant text := '/api/internal/agent-runtime-watchdog/tick';
  v_secret text;
  v_timestamp text;
  v_nonce uuid := gen_random_uuid();
  v_signature text;
  v_request bigint;
begin
  select btrim(decrypted_secret) into v_secret
  from vault.decrypted_secrets
  where name = 'meta_leadgen_scheduler_secret'
  order by updated_at desc
  limit 1;

  if v_secret is null or octet_length(v_secret) < 32 then
    insert into private.agent_runtime_scheduler_dispatches(queue, nonce, status)
    values ('runtime_watchdog', v_nonce, 'config_missing');
    return null;
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_signature := encode(
    extensions.hmac(
      convert_to(concat_ws(E'\n', 'POST', v_path, v_timestamp, v_nonce::text), 'UTF8'),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select net.http_post(
    url := 'https://www.mychatcrm.com.br' || v_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-MyChatCRM-Timestamp', v_timestamp,
      'X-MyChatCRM-Nonce', v_nonce::text,
      'X-MyChatCRM-Signature', 'sha256=' || v_signature
    ),
    timeout_milliseconds := 10000
  ) into v_request;

  insert into private.agent_runtime_scheduler_dispatches(queue, nonce, request_id, status)
  values ('runtime_watchdog', v_nonce, v_request, 'queued');
  return v_request;
exception when others then
  insert into private.agent_runtime_scheduler_dispatches(queue, nonce, status)
  values ('runtime_watchdog', v_nonce, 'request_failed');
  return null;
end;
$$;

revoke all on function private.dispatch_agent_runtime_watchdog_tick_v1()
  from public, anon, authenticated;
grant execute on function private.dispatch_agent_runtime_watchdog_tick_v1()
  to service_role;

do $watchdog_cron$
declare v_job bigint;
begin
  if to_regnamespace('cron') is null then return; end if;
  for v_job in
    select jobid from cron.job where jobname = 'mychatcrm-agent-runtime-watchdog-five-minute'
  loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule(
    'mychatcrm-agent-runtime-watchdog-five-minute',
    '2-57/5 * * * *',
    'select private.dispatch_agent_runtime_watchdog_tick_v1();'
  );
end;
$watchdog_cron$;

