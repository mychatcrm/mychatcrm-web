-- Follow-up configuration fidelity:
-- 1) renew an active journey atomically after a confirmed automated outbound;
-- 2) invoke only the follow-up worker every minute from Supabase/Vault.
-- Additive and compatible with the existing daily Vercel fallback.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;

create or replace function public.touch_active_lead_journey_v2(
  p_tenant_id text,
  p_journey_id uuid,
  p_lead_id uuid default null,
  p_occurred_at timestamptz default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule_id uuid;
  v_current_activity timestamptz;
  v_activity timestamptz;
  v_inactivity_minutes integer := 1440;
begin
  if p_tenant_id is null or btrim(p_tenant_id) = '' or p_journey_id is null then
    return false;
  end if;

  if p_lead_id is not null and not exists (
    select 1
      from public.leads l
     where l.id = p_lead_id
       and l.tenant_id = p_tenant_id
  ) then
    return false;
  end if;

  select j.rule_id, j.last_activity_at
    into v_rule_id, v_current_activity
    from public.lead_journeys j
   where j.id = p_journey_id
     and j.tenant_id = p_tenant_id
     and j.status = 'active'
   for update;

  if not found then
    return false;
  end if;

  if v_rule_id is not null then
    select greatest(1, least(coalesce(r.conflict_inactivity_minutes, 1440), 525600))
      into v_inactivity_minutes
      from public.lead_distribution_rules r
     where r.id = v_rule_id
       and r.tenant_id = p_tenant_id;
    v_inactivity_minutes := coalesce(v_inactivity_minutes, 1440);
  end if;

  -- Never move activity backwards. A small future-clock tolerance avoids a
  -- provider timestamp extending a journey arbitrarily far into the future.
  v_activity := greatest(
    coalesce(v_current_activity, '-infinity'::timestamptz),
    least(coalesce(p_occurred_at, clock_timestamp()), clock_timestamp() + interval '5 minutes')
  );

  update public.lead_journeys
     set lead_id = coalesce(p_lead_id, lead_id),
         last_activity_at = v_activity,
         expires_at = v_activity + make_interval(mins => v_inactivity_minutes),
         updated_at = clock_timestamp()
   where id = p_journey_id
     and tenant_id = p_tenant_id
     and status = 'active';

  return found;
end;
$$;

revoke all on function public.touch_active_lead_journey_v2(text, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.touch_active_lead_journey_v2(text, uuid, uuid, timestamptz)
  to service_role;

create table if not exists private.follow_up_scheduler_dispatches (
  id bigint generated always as identity primary key,
  dispatched_at timestamptz not null default now(),
  nonce uuid,
  request_id bigint,
  status text not null
    check (status in ('queued', 'config_missing', 'request_failed'))
);

create index if not exists follow_up_scheduler_dispatches_created_idx
  on private.follow_up_scheduler_dispatches (dispatched_at desc);
create index if not exists follow_up_scheduler_dispatches_nonce_idx
  on private.follow_up_scheduler_dispatches (nonce)
  where nonce is not null;

revoke all on table private.follow_up_scheduler_dispatches
  from public, anon, authenticated;
grant select, insert, update, delete on table private.follow_up_scheduler_dispatches
  to service_role;
grant usage, select on sequence private.follow_up_scheduler_dispatches_id_seq
  to service_role;

create or replace function private.dispatch_follow_up_processing()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_timestamp text;
  v_nonce uuid;
  v_path constant text := '/api/internal/process-follow-ups';
  v_signature text;
  v_request bigint;
begin
  select btrim(decrypted_secret)
    into v_secret
    from vault.decrypted_secrets
   where name = 'meta_leadgen_scheduler_secret'
   order by updated_at desc
   limit 1;

  if v_secret is null or octet_length(v_secret) < 32 then
    insert into private.follow_up_scheduler_dispatches(status)
    values ('config_missing');
    return null;
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce := gen_random_uuid();
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

  insert into private.follow_up_scheduler_dispatches(nonce, request_id, status)
  values (v_nonce, v_request, 'queued');
  return v_request;
exception when others then
  insert into private.follow_up_scheduler_dispatches(nonce, status)
  values (v_nonce, 'request_failed');
  return null;
end;
$$;

revoke all on function private.dispatch_follow_up_processing()
  from public, anon, authenticated;
grant execute on function private.dispatch_follow_up_processing()
  to service_role;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'mychatcrm-follow-up-minute';

select cron.schedule(
  'mychatcrm-follow-up-minute',
  '* * * * *',
  $$select private.dispatch_follow_up_processing();$$
);
