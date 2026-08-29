-- Durable universal runtime v3.
-- Additive contracts only: legacy reminder rows are intentionally left untouched.

-- Reminder obligations follow only the reminder configuration. Editing an
-- unrelated prompt, display name or CRM setting must not invalidate them.
alter table public.tenant_agents
  add column if not exists agenda_reminder_config_version bigint not null default 1;

create or replace function private.bump_agenda_reminder_config_version_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.metadata->'agendaLembretes','null'::jsonb)
     is distinct from coalesce(old.metadata->'agendaLembretes','null'::jsonb) then
    new.agenda_reminder_config_version := old.agenda_reminder_config_version + 1;
  else
    new.agenda_reminder_config_version := old.agenda_reminder_config_version;
  end if;
  return new;
end;
$$;
revoke all on function private.bump_agenda_reminder_config_version_v2() from public,anon,authenticated;

drop trigger if exists tenant_agent_bump_reminder_config_v2 on public.tenant_agents;
create trigger tenant_agent_bump_reminder_config_v2
before update of metadata on public.tenant_agents
for each row execute function private.bump_agenda_reminder_config_version_v2();

create table if not exists public.agenda_reminder_jobs_v2 (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  agent_id text not null,
  agenda_event_id uuid not null references public.agenda_events(id) on delete cascade,
  remote_jid text not null,
  lead_id uuid null references public.leads(id) on delete set null,
  journey_id uuid not null references public.lead_journeys(id) on delete cascade,
  rule_id uuid not null references public.lead_distribution_rules(id) on delete restrict,
  channel text not null check (channel in ('evolution', 'meta_cloud')),
  connection_id text not null,
  automation_epoch bigint not null,
  config_version bigint not null,
  reminder_index integer not null check (reminder_index between 0 and 9),
  operation_key text not null,
  scheduled_at timestamptz not null,
  rendered_message text not null check (length(btrim(rendered_message)) > 0),
  timezone text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'cancelled', 'exhausted')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  claim_token uuid null,
  claimed_at timestamptz null,
  heartbeat_at timestamptz null,
  claim_expires_at timestamptz null,
  next_attempt_at timestamptz not null,
  outbox_id uuid null references public.agent_outbound_outbox(id) on delete set null,
  provider_message_id text null,
  authorized_at timestamptz null,
  sent_at timestamptz null,
  completed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, operation_key)
);

create index if not exists agenda_reminder_jobs_v2_due_idx
  on public.agenda_reminder_jobs_v2 (next_attempt_at, scheduled_at)
  where status = 'pending';
create index if not exists agenda_reminder_jobs_v2_event_idx
  on public.agenda_reminder_jobs_v2 (tenant_id, agenda_event_id, status);
create index if not exists agenda_reminder_jobs_v2_conversation_idx
  on public.agenda_reminder_jobs_v2 (tenant_id, remote_jid, status);
create index if not exists agenda_reminder_jobs_v2_claim_idx
  on public.agenda_reminder_jobs_v2 (claim_expires_at)
  where status = 'processing';

alter table public.agenda_reminder_jobs_v2 enable row level security;
revoke all on table public.agenda_reminder_jobs_v2 from public, anon, authenticated;
grant select, insert, update, delete on table public.agenda_reminder_jobs_v2 to service_role;

create or replace function public.enqueue_agenda_reminder_v2(
  p_tenant_id text,
  p_agent_id text,
  p_agenda_event_id uuid,
  p_remote_jid text,
  p_lead_id uuid,
  p_journey_id uuid,
  p_rule_id uuid,
  p_channel text,
  p_connection_id text,
  p_automation_epoch bigint,
  p_config_version bigint,
  p_reminder_index integer,
  p_operation_key text,
  p_scheduled_at timestamptz,
  p_rendered_message text,
  p_timezone text,
  p_max_attempts integer default 4
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_event public.agenda_events%rowtype;
  v_journey public.lead_journeys%rowtype;
  v_rule public.lead_distribution_rules%rowtype;
  v_state public.conversation_states%rowtype;
begin
  if p_channel not in ('evolution', 'meta_cloud')
     or nullif(btrim(p_connection_id), '') is null
     or nullif(btrim(p_rendered_message), '') is null
     or p_scheduled_at <= now() then
    raise exception 'agenda_reminder_identity_invalid';
  end if;

  select * into v_event from public.agenda_events where id = p_agenda_event_id for share;
  select * into v_journey from public.lead_journeys where id = p_journey_id for share;
  select * into v_rule from public.lead_distribution_rules where id = p_rule_id for share;
  select * into v_state from public.conversation_states
   where tenant_id = p_tenant_id and remote_jid = p_remote_jid and channel = 'whatsapp'
   for share;

  if v_event.id is null or v_event.tenant_id is distinct from p_tenant_id
     or v_event.agent_id is distinct from p_agent_id or v_event.status <> 'confirmed'
     or v_journey.id is null or v_journey.tenant_id is distinct from p_tenant_id
     or v_journey.agent_id is distinct from p_agent_id
     or v_journey.remote_jid is distinct from p_remote_jid
     or v_journey.rule_id is distinct from p_rule_id
     or v_journey.connection_id is distinct from p_connection_id
     or v_journey.status <> 'active' or v_journey.expires_at is null or v_journey.expires_at <= now()
     or v_rule.id is null or not v_rule.active or v_rule.tenant_id is distinct from p_tenant_id
     or v_rule.connection_id is distinct from p_connection_id
     or not jsonb_exists(coalesce(v_rule.agent_ids, '[]'::jsonb), p_agent_id)
     or (p_channel = 'evolution' and v_rule.transport is distinct from 'evolution')
     or (p_channel = 'meta_cloud' and v_rule.transport is distinct from 'cloud_api')
     or v_state.id is null or v_state.active_journey_id is distinct from p_journey_id
     or v_state.automation_epoch is distinct from p_automation_epoch
     or v_state.human_paused or v_state.conversation_mode is distinct from 'automation' then
    raise exception 'agenda_reminder_authorization_invalid';
  end if;

  insert into public.agenda_reminder_jobs_v2 (
    tenant_id, agent_id, agenda_event_id, remote_jid, lead_id, journey_id,
    rule_id, channel, connection_id, automation_epoch, config_version,
    reminder_index, operation_key, scheduled_at, next_attempt_at,
    rendered_message, timezone, max_attempts
  ) values (
    p_tenant_id, p_agent_id, p_agenda_event_id, p_remote_jid, p_lead_id,
    p_journey_id, p_rule_id, p_channel, p_connection_id, p_automation_epoch,
    p_config_version, p_reminder_index, p_operation_key, p_scheduled_at,
    p_scheduled_at, p_rendered_message, p_timezone,
    greatest(1, least(coalesce(p_max_attempts, 4), 10))
  )
  on conflict (tenant_id, operation_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.agenda_reminder_jobs_v2
     where tenant_id = p_tenant_id and operation_key = p_operation_key;
  end if;
  return v_id;
end;
$$;

create or replace function public.claim_agenda_reminder_jobs_v2(
  p_limit integer default 10,
  p_claim_seconds integer default 120
)
returns setof public.agenda_reminder_jobs_v2
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.agenda_reminder_jobs_v2
     set status = 'pending', claim_token = null, claimed_at = null,
         heartbeat_at = null, claim_expires_at = null,
         next_attempt_at = greatest(next_attempt_at, now()),
         last_error = 'claim_expired', updated_at = now()
   where status = 'processing' and claim_expires_at < now()
     and provider_message_id is null and sent_at is null;

  return query
  with candidates as (
    select id from public.agenda_reminder_jobs_v2
     where status = 'pending' and scheduled_at <= now() and next_attempt_at <= now()
     order by scheduled_at, created_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update public.agenda_reminder_jobs_v2 j
       set status = 'processing', claim_token = gen_random_uuid(), claimed_at = now(),
           heartbeat_at = now(), claim_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_claim_seconds, 120), 600))),
           updated_at = now()
      from candidates c where j.id = c.id
    returning j.*
  ) select * from claimed;
end;
$$;

create or replace function public.heartbeat_agenda_reminder_job_v2(
  p_id uuid, p_claim_token uuid, p_claim_seconds integer default 120
)
returns boolean
language sql
security invoker
set search_path = public
as $$
  update public.agenda_reminder_jobs_v2
     set heartbeat_at = now(), claim_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_claim_seconds, 120), 600))), updated_at = now()
   where id = p_id and status = 'processing' and claim_token = p_claim_token
     and claim_expires_at >= now()
  returning true;
$$;

create or replace function public.finish_agenda_reminder_job_v2(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_attempts integer,
  p_next_attempt_at timestamptz,
  p_last_error text,
  p_outbox_id uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('pending', 'sent', 'cancelled', 'exhausted') then
    raise exception 'agenda_reminder_finish_status_invalid';
  end if;
  update public.agenda_reminder_jobs_v2
     set status = p_status,
         attempts = greatest(0, coalesce(p_attempts, attempts)),
         next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
         last_error = p_last_error,
         outbox_id = coalesce(p_outbox_id, outbox_id),
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         authorized_at = case when p_outbox_id is not null then coalesce(authorized_at, now()) else authorized_at end,
         sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
         completed_at = case when p_status in ('sent','cancelled','exhausted') then now() else null end,
         claim_token = null, claimed_at = null, heartbeat_at = null, claim_expires_at = null,
         updated_at = now()
   where id = p_id and status = 'processing' and claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.cancel_agenda_reminders_v2(
  p_tenant_id text,
  p_reason text,
  p_event_id uuid default null,
  p_remote_jid text default null,
  p_agent_id text default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  update public.agenda_reminder_jobs_v2
     set status = 'cancelled', last_error = coalesce(nullif(btrim(p_reason), ''), 'cancelled'),
         completed_at = now(), claim_token = null, claimed_at = null,
         heartbeat_at = null, claim_expires_at = null, updated_at = now()
   where tenant_id = p_tenant_id and status in ('pending', 'processing')
     and (p_event_id is null or agenda_event_id = p_event_id)
     and (p_remote_jid is null or remote_jid = p_remote_jid)
     and (p_agent_id is null or agent_id = p_agent_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in (
     'enqueue_agenda_reminder_v2','claim_agenda_reminder_jobs_v2',
     'heartbeat_agenda_reminder_job_v2','finish_agenda_reminder_job_v2',
     'cancel_agenda_reminders_v2'
   )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

create or replace function private.cancel_reminders_on_conversation_control_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.human_paused or new.conversation_mode is distinct from 'automation'
     or new.automation_epoch is distinct from old.automation_epoch then
    update public.agenda_reminder_jobs_v2
       set status='cancelled', last_error='conversation_control_changed', completed_at=now(),
           claim_token=null, claimed_at=null, heartbeat_at=null, claim_expires_at=null, updated_at=now()
     where tenant_id=new.tenant_id and remote_jid=new.remote_jid
       and status in ('pending','processing');
  end if;
  return new;
end;
$$;
drop trigger if exists conversation_cancel_reminders_v2 on public.conversation_states;
create trigger conversation_cancel_reminders_v2
after update of human_paused, conversation_mode, automation_epoch on public.conversation_states
for each row execute function private.cancel_reminders_on_conversation_control_v2();

create or replace function private.cancel_reminders_on_event_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'confirmed' or new.start_at is distinct from old.start_at then
    update public.agenda_reminder_jobs_v2
       set status='cancelled', last_error=case when new.status <> 'confirmed' then 'agenda_event_cancelled' else 'agenda_event_rescheduled' end,
           completed_at=now(), claim_token=null, claimed_at=null, heartbeat_at=null, claim_expires_at=null, updated_at=now()
     where agenda_event_id=new.id and status in ('pending','processing');
  end if;
  return new;
end;
$$;
drop trigger if exists agenda_event_cancel_reminders_v2 on public.agenda_events;
create trigger agenda_event_cancel_reminders_v2
after update of status, start_at on public.agenda_events
for each row execute function private.cancel_reminders_on_event_v2();

create or replace function private.cancel_reminders_on_agent_config_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active is false or new.archived_at is not null
     or coalesce(new.metadata->'agendaLembretes','null'::jsonb)
        is distinct from coalesce(old.metadata->'agendaLembretes','null'::jsonb) then
    update public.agenda_reminder_jobs_v2
       set status='cancelled', last_error='agenda_reminder_configuration_changed', completed_at=now(),
           claim_token=null, claimed_at=null, heartbeat_at=null, claim_expires_at=null, updated_at=now()
     where tenant_id=new.tenant_id and agent_id=new.agent_id and status in ('pending','processing');
  end if;
  if new.active is false or new.archived_at is not null
     or coalesce(new.metadata->'followUpInteligente','null'::jsonb)
        is distinct from coalesce(old.metadata->'followUpInteligente','null'::jsonb) then
    update public.follow_up_jobs
       set status='cancelled', last_error='follow_up_configuration_changed',
           claim_token=null, claimed_at=null, heartbeat_at=null, claim_expires_at=null, updated_at=now()
     where tenant_id=new.tenant_id and agent_id=new.agent_id and status in ('pending','processing');
  end if;
  return new;
end;
$$;
drop trigger if exists tenant_agent_cancel_reminders_v2 on public.tenant_agents;
create trigger tenant_agent_cancel_reminders_v2
after update of active, archived_at, metadata on public.tenant_agents
for each row execute function private.cancel_reminders_on_agent_config_v2();

revoke all on function private.cancel_reminders_on_conversation_control_v2() from public,anon,authenticated;
revoke all on function private.cancel_reminders_on_event_v2() from public,anon,authenticated;
revoke all on function private.cancel_reminders_on_agent_config_v2() from public,anon,authenticated;

-- No legacy follow-up is replayed after this contract becomes active.
update public.follow_up_jobs
   set status='cancelled', last_error='follow_up_v3_activation_no_retroactive_send', updated_at=now()
 where status in ('pending','processing');
alter table public.follow_up_jobs add column if not exists response_confirmed_at timestamptz null;
alter table public.follow_up_jobs
  add column if not exists source_response_job_id uuid null references public.agent_response_jobs(id) on delete set null,
  add column if not exists source_generation integer null;
create unique index if not exists follow_up_jobs_source_response_unique
  on public.follow_up_jobs(tenant_id, source_response_job_id, source_generation)
  where source_response_job_id is not null and source_generation is not null;
create index if not exists follow_up_jobs_response_confirmed_idx
  on public.follow_up_jobs (tenant_id, remote_jid, response_confirmed_at)
  where status in ('pending','processing');

-- Authenticated Evolution webhook events are stored before any expensive work.
create table if not exists public.evolution_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  instance_name text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid null,
  claimed_at timestamptz null,
  heartbeat_at timestamptz null,
  claim_expires_at timestamptz null,
  last_error text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists evolution_webhook_inbox_due_idx
  on public.evolution_webhook_inbox(next_attempt_at, created_at) where status='pending';
create index if not exists evolution_webhook_inbox_claim_idx
  on public.evolution_webhook_inbox(claim_expires_at) where status='processing';
alter table public.evolution_webhook_inbox enable row level security;
revoke all on table public.evolution_webhook_inbox from public,anon,authenticated;
grant select,insert,update,delete on table public.evolution_webhook_inbox to service_role;

create or replace function public.claim_evolution_webhook_inbox_v1(p_limit integer default 5, p_claim_seconds integer default 240)
returns setof public.evolution_webhook_inbox
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.evolution_webhook_inbox set status='pending', claim_token=null, claimed_at=null,
    heartbeat_at=null, claim_expires_at=null, next_attempt_at=now(), last_error='claim_expired', updated_at=now()
  where status='processing' and claim_expires_at < now();
  return query with c as (
    select id from public.evolution_webhook_inbox
    where status='pending' and next_attempt_at<=now()
    order by created_at for update skip locked limit greatest(1,least(coalesce(p_limit,5),20))
  ), u as (
    update public.evolution_webhook_inbox i set status='processing',claim_token=gen_random_uuid(),
      claimed_at=now(),heartbeat_at=now(),claim_expires_at=now()+make_interval(secs=>greatest(60,least(coalesce(p_claim_seconds,240),600))),updated_at=now()
    from c where i.id=c.id returning i.*
  ) select * from u;
end; $$;

create or replace function public.finish_evolution_webhook_inbox_v1(
 p_id uuid,p_claim_token uuid,p_ok boolean,p_retryable boolean,p_last_error text
)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_attempts integer;
begin
  select attempts into v_attempts from public.evolution_webhook_inbox
   where id=p_id and status='processing' and claim_token=p_claim_token for update;
  if not found then return false; end if;
  v_attempts:=v_attempts+case when p_ok then 0 else 1 end;
  update public.evolution_webhook_inbox set
    status=case when p_ok then 'completed' when p_retryable and v_attempts<max_attempts then 'pending' else 'dead_letter' end,
    attempts=v_attempts,
    next_attempt_at=case when not p_ok and p_retryable and v_attempts<max_attempts then now()+make_interval(secs=>least(900,15*(2^least(v_attempts,6))::integer)) else next_attempt_at end,
    last_error=p_last_error, completed_at=case when p_ok or not p_retryable or v_attempts>=max_attempts then now() else null end,
    claim_token=null,claimed_at=null,heartbeat_at=null,claim_expires_at=null,updated_at=now()
  where id=p_id and claim_token=p_claim_token;
  return found;
end; $$;

revoke all on function public.claim_evolution_webhook_inbox_v1(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_evolution_webhook_inbox_v1(integer,integer) to service_role;
revoke all on function public.finish_evolution_webhook_inbox_v1(uuid,uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_evolution_webhook_inbox_v1(uuid,uuid,boolean,boolean,text) to service_role;

-- Defensive RLS for server-only operational tables flagged by advisors.
alter table if exists public.agenda_debug_log enable row level security;
alter table if exists public.coupon_extra_codes enable row level security;

create table if not exists public.agent_runtime_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text null,
  agent_id text null,
  code text not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  resource_type text null,
  resource_id text null,
  details jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz null,
  unique(fingerprint,status)
);
alter table public.agent_runtime_alerts enable row level security;
revoke all on table public.agent_runtime_alerts from public,anon,authenticated;
grant select,insert,update,delete on table public.agent_runtime_alerts to service_role;

create or replace function private.monitor_agent_runtime_v3()
returns void language plpgsql security definer set search_path='' as $$
declare v_count bigint;
begin
  select count(*) into v_count from public.evolution_webhook_inbox where status='pending' and created_at<now()-interval '3 minutes';
  if v_count>0 then insert into public.agent_runtime_alerts(code,severity,resource_type,details,fingerprint)
    values('evolution_inbox_backlog',case when v_count>50 then 'critical' else 'warning' end,'queue',jsonb_build_object('count',v_count),'global:evolution_inbox_backlog:open')
    on conflict(fingerprint,status) do update set last_seen_at=now(),details=excluded.details,severity=excluded.severity; end if;
  select count(*) into v_count from public.follow_up_jobs where status='processing' and claim_expires_at<now();
  if v_count>0 then insert into public.agent_runtime_alerts(code,severity,resource_type,details,fingerprint)
    values('follow_up_claims_expired','warning','queue',jsonb_build_object('count',v_count),'global:follow_up_claims_expired:open')
    on conflict(fingerprint,status) do update set last_seen_at=now(),details=excluded.details; end if;
  select count(*) into v_count from public.agenda_reminder_jobs_v2 where status='processing' and claim_expires_at<now();
  if v_count>0 then insert into public.agent_runtime_alerts(code,severity,resource_type,details,fingerprint)
    values('agenda_reminder_claims_expired','warning','queue',jsonb_build_object('count',v_count),'global:agenda_reminder_claims_expired:open')
    on conflict(fingerprint,status) do update set last_seen_at=now(),details=excluded.details; end if;
  select count(*) into v_count from public.follow_up_jobs
   where status='pending' and updated_at<now()-interval '5 minutes';
  if v_count>0 then insert into public.agent_runtime_alerts(code,severity,resource_type,details,fingerprint)
    values('follow_up_backlog','warning','queue',jsonb_build_object('count',v_count),'global:follow_up_backlog:open')
    on conflict(fingerprint,status) do update set last_seen_at=now(),details=excluded.details; end if;
  select count(*) into v_count from private.agent_runtime_scheduler_dispatches
   where dispatched_at>now()-interval '5 minutes' and status in ('config_missing','request_failed');
  if v_count>0 then insert into public.agent_runtime_alerts(code,severity,resource_type,details,fingerprint)
    values('agent_runtime_scheduler_failure','critical','scheduler',jsonb_build_object('count',v_count),'global:agent_runtime_scheduler_failure:open')
    on conflict(fingerprint,status) do update set last_seen_at=now(),details=excluded.details,severity=excluded.severity; end if;
end; $$;
revoke all on function private.monitor_agent_runtime_v3() from public,anon,authenticated;
grant execute on function private.monitor_agent_runtime_v3() to service_role;

-- One tenant-scoped dependency report; JSON arrays are inspected in SQL and
-- reminder V2 obligations participate in the existing atomic lifecycle gate.
create or replace function public.get_agent_dependency_report_v1(p_tenant_id text, p_agent_id text)
returns jsonb language sql security invoker set search_path=public as $$
  select jsonb_build_object(
    'rules',(select count(*) from public.lead_distribution_rules r where r.tenant_id=p_tenant_id and r.active and jsonb_exists(coalesce(r.agent_ids,'[]'::jsonb),p_agent_id)),
    'journeys',(select count(*) from public.lead_journeys j where j.tenant_id=p_tenant_id and j.agent_id=p_agent_id and j.status='active' and coalesce(j.expires_at,'infinity'::timestamptz)>now()),
    'responseJobs',(select count(*) from public.agent_response_jobs j where j.tenant_id=p_tenant_id and j.agent_id=p_agent_id and j.status in ('pending','processing')),
    'followUps',(
      (select count(*) from public.follow_up_jobs f where f.tenant_id=p_tenant_id and f.agent_id=p_agent_id and f.status in ('pending','processing'))+
      (select count(*) from public.agenda_reminder_jobs_v2 a where a.tenant_id=p_tenant_id and a.agent_id=p_agent_id and a.status in ('pending','processing'))
    ),
    'reminders',(select count(*) from public.agenda_reminder_jobs_v2 a where a.tenant_id=p_tenant_id and a.agent_id=p_agent_id and a.status in ('pending','processing')),
    'campaigns',(select count(*) from public.whatsapp_campaigns c where c.tenant_id=p_tenant_id and c.agent_id=p_agent_id and c.status in ('scheduled','processing','paused')),
    'metaMappings',(select count(*) from public.meta_form_agent_mapping m where m.tenant_id=p_tenant_id and m.agent_id=p_agent_id),
    'organicConnections',(select count(*) from public.tenant_evolution_instances i where i.tenant_id=p_tenant_id and i.organic_agent_id=p_agent_id)
  );
$$;
revoke all on function public.get_agent_dependency_report_v1(text,text) from public,anon,authenticated;
grant execute on function public.get_agent_dependency_report_v1(text,text) to service_role;

-- Scheduler dispatches are isolated by queue so one runtime cannot starve another.
create table if not exists private.agent_runtime_scheduler_dispatches (
  id bigint generated by default as identity primary key,
  queue text not null,
  nonce uuid null,
  request_id bigint null,
  status text not null,
  dispatched_at timestamptz not null default now()
);
revoke all on table private.agent_runtime_scheduler_dispatches from public,anon,authenticated;
grant select,insert,update,delete on table private.agent_runtime_scheduler_dispatches to service_role;
grant usage,select on sequence private.agent_runtime_scheduler_dispatches_id_seq to service_role;

create or replace function private.dispatch_agent_runtime_queue(p_queue text, p_path text)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_secret text; v_timestamp text; v_nonce uuid; v_signature text; v_request bigint;
begin
  if p_queue not in ('agenda_reminders','evolution_inbox')
     or p_path not in ('/api/internal/process-agenda-reminders','/api/internal/process-evolution-inbox') then
    raise exception 'runtime_queue_invalid';
  end if;
  select btrim(decrypted_secret) into v_secret from vault.decrypted_secrets
   where name='meta_leadgen_scheduler_secret' order by updated_at desc limit 1;
  if v_secret is null or octet_length(v_secret)<32 then
    insert into private.agent_runtime_scheduler_dispatches(queue,status) values(p_queue,'config_missing'); return null;
  end if;
  v_timestamp:=floor(extract(epoch from clock_timestamp()))::bigint::text; v_nonce:=gen_random_uuid();
  v_signature:=encode(extensions.hmac(convert_to(concat_ws(E'\n','POST',p_path,v_timestamp,v_nonce::text),'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  select net.http_post(url:='https://www.mychatcrm.com.br'||p_path,body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','X-MyChatCRM-Timestamp',v_timestamp,'X-MyChatCRM-Nonce',v_nonce::text,'X-MyChatCRM-Signature','sha256='||v_signature),timeout_milliseconds:=10000) into v_request;
  insert into private.agent_runtime_scheduler_dispatches(queue,nonce,request_id,status) values(p_queue,v_nonce,v_request,'queued');
  return v_request;
exception when others then
  insert into private.agent_runtime_scheduler_dispatches(queue,nonce,status) values(coalesce(p_queue,'unknown'),v_nonce,'request_failed'); return null;
end; $$;
revoke all on function private.dispatch_agent_runtime_queue(text,text) from public,anon,authenticated;
grant execute on function private.dispatch_agent_runtime_queue(text,text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname in ('mychatcrm-agenda-reminders-minute','mychatcrm-evolution-inbox-minute','mychatcrm-agent-runtime-monitor-minute');
select cron.schedule('mychatcrm-agenda-reminders-minute','* * * * *',
  $$select private.dispatch_agent_runtime_queue('agenda_reminders','/api/internal/process-agenda-reminders');$$);
select cron.schedule('mychatcrm-evolution-inbox-minute','* * * * *',
  $$select private.dispatch_agent_runtime_queue('evolution_inbox','/api/internal/process-evolution-inbox');$$);
select cron.schedule('mychatcrm-agent-runtime-monitor-minute','* * * * *',
  $$select private.monitor_agent_runtime_v3();$$);
