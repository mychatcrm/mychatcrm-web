-- Backend-only laboratory data. Public schema is used for the service Data API;
-- no browser role receives table privileges or policies.
create table public.agent_test_lab_sessions (
 token_hash text primary key check(length(token_hash)=64), admin_id text not null,
 password_version timestamptz, created_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz
);
create table public.agent_test_lab_rate_limits (
 bucket text primary key, window_started_at timestamptz not null, attempts integer not null
);
create table public.agent_test_lab_connections (
 id uuid primary key default gen_random_uuid(), owner_admin_id text not null,
 purpose text not null check(purpose in ('sender','receiver')), instance_name text not null unique,
 state text not null default 'disconnected', wa_jid text, webhook_secret_hash text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 archived_at timestamptz
);
create unique index agent_test_lab_connection_purpose on public.agent_test_lab_connections(owner_admin_id,purpose) where archived_at is null;
create table public.agent_test_lab_scenarios (
 id uuid primary key default gen_random_uuid(), owner_admin_id text not null, name text not null,
 version integer not null default 1, definition jsonb not null, created_at timestamptz not null default now(),
 archived_at timestamptz
);
create table public.agent_test_lab_runs (
 id uuid primary key default gen_random_uuid(), trace_id uuid not null default gen_random_uuid(),
 owner_admin_id text not null, mode text not null, status text not null default 'queued'
 check(status in ('queued','running','paused','waiting_reply','waiting_input','stopping','completed','failed','cancelled')),
 verdict text check(verdict in ('passed','failed','expected_block','inconclusive','not_executed')),
 sender_connection_id uuid references public.agent_test_lab_connections(id),
 target_tenant_id text, target_agent_id text, target_connection_id uuid, target_rule_id uuid,
 target_channel text check(target_channel in ('evolution','meta_cloud')), target_jid text,
 deployed_sha text not null, config_hash text not null, scenario_hash text not null,
 request jsonb not null, preflight jsonb not null default '[]',
 max_messages integer not null check(max_messages between 1 and 1000), sent_messages integer not null default 0,
 budget_brl numeric(12,4) not null check(budget_brl>0), reserved_brl numeric(12,4) not null default 0,
 spent_brl numeric(12,4) not null default 0, billing_reference text not null default 'platform_test',
 deadline_at timestamptz not null, next_step_at timestamptz not null default now(),
 workflow_run_id bigint, result_code text, claim_token uuid, claim_expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz
);
create unique index agent_test_lab_one_active_sender on public.agent_test_lab_runs(sender_connection_id)
 where sender_connection_id is not null and status in ('running','paused','waiting_reply','waiting_input','stopping');
create index agent_test_lab_run_due on public.agent_test_lab_runs(next_step_at) where status in ('queued','running','waiting_reply','waiting_input','paused','stopping');
create table public.agent_test_lab_steps (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.agent_test_lab_runs(id),
 ordinal integer not null, kind text not null, status text not null default 'pending',
 command jsonb not null, idempotency_key text not null unique,
 provider_message_id text, dispatch_started_at timestamptz, confirmed_at timestamptz,
 result_code text, created_at timestamptz not null default now(), unique(run_id,ordinal)
);
create table public.agent_test_lab_messages (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.agent_test_lab_runs(id),
 direction text not null check(direction in ('tester','agent')), kind text not null,
 content text, asset_id uuid, provider_message_id text, provider_occurred_at timestamptz,
 received_at timestamptz not null default now(), unique(run_id,direction,provider_message_id)
);
create table public.agent_test_lab_assets (
 id uuid primary key default gen_random_uuid(), owner_admin_id text not null,
 run_id uuid references public.agent_test_lab_runs(id), storage_path text not null unique,
 kind text not null, mime_type text not null, byte_size bigint not null check(byte_size between 1 and 20971520),
 filename text not null, expected_facts jsonb not null default '[]', checksum text not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '30 days')
);
create table public.agent_test_lab_evidence (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.agent_test_lab_runs(id),
 check_code text not null, verdict text not null, description text not null, resource_ids jsonb not null default '[]',
 created_at timestamptz not null default now(), unique(run_id,check_code)
);
create table public.agent_test_lab_resources (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.agent_test_lab_runs(id),
 tenant_id text not null, resource_type text not null, resource_id text not null,
 cleanup_status text not null default 'not_requested', created_at timestamptz not null default now(),
 unique(tenant_id,resource_type,resource_id)
);
create table public.agent_test_lab_costs (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.agent_test_lab_runs(id),
 operation_key text not null unique, category text not null, reserved_brl numeric(12,4) not null,
 actual_brl numeric(12,4), provider_request_id text, created_at timestamptz not null default now()
);
create table public.agent_test_lab_destinations (
 id uuid primary key default gen_random_uuid(), owner_admin_id text not null, tenant_id text not null,
 connection_id uuid not null, channel text not null, target_jid text not null,
 confirmed_at timestamptz not null default now(), revoked_at timestamptz,
 unique(owner_admin_id,tenant_id,connection_id,channel,target_jid)
);
do $permissions$ declare t text; begin
 foreach t in array array['sessions','rate_limits','connections','scenarios','runs','steps','messages','assets','evidence','resources','costs','destinations'] loop
   execute format('alter table public.%I enable row level security','agent_test_lab_'||t);
   execute format('revoke all on public.%I from public,anon,authenticated','agent_test_lab_'||t);
   execute format('grant select,insert,update,delete on public.%I to service_role','agent_test_lab_'||t);
 end loop;
end $permissions$;

create function public.consume_agent_test_lab_rate_v1(p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare n integer; begin
 if length(p_bucket)>150 or p_limit not between 1 and 1000 or p_seconds not between 1 and 86400 then raise exception 'invalid_rate'; end if;
 insert into public.agent_test_lab_rate_limits(bucket,window_started_at,attempts) values(p_bucket,now(),1)
 on conflict(bucket) do update set
 attempts=case when agent_test_lab_rate_limits.window_started_at<=now()-make_interval(secs=>p_seconds) then 1 else agent_test_lab_rate_limits.attempts+1 end,
 window_started_at=case when agent_test_lab_rate_limits.window_started_at<=now()-make_interval(secs=>p_seconds) then now() else agent_test_lab_rate_limits.window_started_at end
 returning attempts into n;
 return n<=p_limit;
end $fn$;
revoke all on function public.consume_agent_test_lab_rate_v1(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_agent_test_lab_rate_v1(text,integer,integer) to service_role;

-- One atomic gate covers limits, active owner and state before any paid call.
create function public.reserve_agent_test_lab_cost_v1(p_run_id uuid,p_key text,p_category text,p_reserve numeric,p_message boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; prior public.agent_test_lab_costs; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id for update;
 if not found then return jsonb_build_object('ok',false,'code','run_missing'); end if;
 if not exists(select 1 from public.admin_users where id=r.owner_admin_id and id='admin-renato-lagares' and active and role='super_admin') then
   return jsonb_build_object('ok',false,'code','owner_inactive'); end if;
 select * into prior from public.agent_test_lab_costs where operation_key=p_key;
 if found then return jsonb_build_object('ok',false,'code','operation_already_reserved'); end if;
 if r.status not in ('running','waiting_reply','waiting_input') or r.deadline_at<=now() then
   return jsonb_build_object('ok',false,'code','run_not_active'); end if;
 if p_reserve<0 or p_reserve is null or p_key is null or length(p_key)>200 then raise exception 'invalid_reservation'; end if;
 if r.spent_brl+r.reserved_brl+p_reserve>r.budget_brl then return jsonb_build_object('ok',false,'code','budget_exhausted'); end if;
 if p_message and r.sent_messages>=r.max_messages then return jsonb_build_object('ok',false,'code','message_limit'); end if;
 insert into public.agent_test_lab_costs(run_id,operation_key,category,reserved_brl) values(p_run_id,p_key,p_category,p_reserve);
 update public.agent_test_lab_runs set reserved_brl=reserved_brl+p_reserve,sent_messages=sent_messages+case when p_message then 1 else 0 end,updated_at=now() where id=p_run_id;
 return jsonb_build_object('ok',true);
end $fn$;
create function public.settle_agent_test_lab_cost_v1(p_run_id uuid,p_key text,p_actual numeric,p_provider_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare c public.agent_test_lab_costs; begin
 perform 1 from public.agent_test_lab_runs where id=p_run_id for update;
 select * into c from public.agent_test_lab_costs where run_id=p_run_id and operation_key=p_key for update;
 if not found or c.actual_brl is not null then return false; end if;
 if p_actual is null or p_actual<0 then raise exception 'invalid_cost'; end if;
 update public.agent_test_lab_costs set actual_brl=p_actual,provider_request_id=p_provider_id where id=c.id;
 update public.agent_test_lab_runs set reserved_brl=greatest(0,reserved_brl-c.reserved_brl),spent_brl=spent_brl+p_actual,updated_at=now() where id=p_run_id;
 return true;
end $fn$;
create function public.claim_agent_test_lab_run_v1(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; token uuid:=gen_random_uuid(); begin
 select * into r from public.agent_test_lab_runs where id=p_run_id for update skip locked;
 if not found or r.status not in ('queued','running','waiting_reply','waiting_input','paused','stopping') or r.next_step_at>now()
   or (r.claim_expires_at is not null and r.claim_expires_at>now()) then return null; end if;
 if r.status in ('paused','waiting_input') and r.deadline_at>now() then return null; end if;
 if r.deadline_at<=now() and r.status<>'stopping' then
   update public.agent_test_lab_runs set status='stopping',result_code='deadline_reached',updated_at=now() where id=p_run_id;
   r.status:='stopping';
 end if;
 -- Never retry a provider call whose acceptance was not confirmed.
 if r.status<>'stopping' and exists(select 1 from public.agent_test_lab_steps where run_id=p_run_id and kind<>'workflow' and dispatch_started_at is not null and confirmed_at is null) then
   update public.agent_test_lab_runs set status='stopping',verdict='inconclusive',result_code='provider_receipt_unknown',updated_at=now() where id=p_run_id;
   r.status:='stopping';
 end if;
 begin
   update public.agent_test_lab_runs set status=case when status='queued' then 'running' else status end,
     claim_token=token,claim_expires_at=now()+interval '90 seconds',updated_at=now() where id=p_run_id;
 exception when unique_violation then return null; end;
 return jsonb_build_object('runId',p_run_id,'claimToken',token);
end $fn$;
create function public.arm_agent_test_lab_step_v1(p_run_id uuid,p_step_id uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id for update;
 if not found or p_claim is null or r.claim_token is null or r.claim_expires_at is null
   or r.status not in ('running','waiting_input') or r.claim_token is distinct from p_claim or r.claim_expires_at<=now() or r.deadline_at<=now() then return false; end if;
 update public.agent_test_lab_steps set dispatch_started_at=now(),status='dispatching'
 where id=p_step_id and run_id=p_run_id and dispatch_started_at is null;
 return found;
end $fn$;
revoke all on function public.arm_agent_test_lab_step_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.arm_agent_test_lab_step_v1(uuid,uuid,uuid) to service_role;
create function public.heartbeat_agent_test_lab_run_v1(p_run_id uuid,p_claim uuid)
returns boolean language sql security invoker set search_path='' as $fn$
 with changed as (
   update public.agent_test_lab_runs set claim_expires_at=now()+interval '90 seconds',updated_at=now()
   where id=p_run_id and claim_token=p_claim and claim_expires_at>now()
   and status in ('running','waiting_reply','stopping') returning id
 ) select exists(select 1 from changed);
$fn$;
create function public.control_agent_test_lab_run_v1(p_run_id uuid,p_owner text,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; s text; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id and owner_admin_id=p_owner for update;
 if not found then raise exception 'run_missing'; end if;
 if not exists(select 1 from public.admin_users where id=p_owner and id='admin-renato-lagares' and active and role='super_admin') then raise exception 'owner_inactive'; end if;
 if r.status in ('completed','failed','cancelled') then return jsonb_build_object('status',r.status); end if;
 s:=case p_action when 'pause' then 'paused' when 'resume' then 'queued' when 'manual' then 'waiting_input' when 'stop' then 'stopping' else null end;
 if s is null then raise exception 'invalid_action'; end if;
 if p_action='resume' and r.status<>'paused' then raise exception 'run_not_paused'; end if;
 if p_action='manual' and r.mode in ('internal','scenarios_10000','scenarios_million','mutation','simulation') then raise exception 'manual_control_not_applicable'; end if;
 if r.status='stopping' and p_action<>'stop' then raise exception 'run_stopping'; end if;
 -- A dispatched call may finish, but future steps cannot reuse this worker's lease.
 update public.agent_test_lab_runs set status=s,claim_token=null,claim_expires_at=null,next_step_at=now(),updated_at=now()
 where id=r.id;
 return jsonb_build_object('status',s);
end $fn$;
revoke all on function public.heartbeat_agent_test_lab_run_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.control_agent_test_lab_run_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.heartbeat_agent_test_lab_run_v1(uuid,uuid) to service_role;
grant execute on function public.control_agent_test_lab_run_v1(uuid,text,text) to service_role;
revoke all on function public.reserve_agent_test_lab_cost_v1(uuid,text,text,numeric,boolean) from public,anon,authenticated;
revoke all on function public.settle_agent_test_lab_cost_v1(uuid,text,numeric,text) from public,anon,authenticated;
revoke all on function public.claim_agent_test_lab_run_v1(uuid) from public,anon,authenticated;
grant execute on function public.reserve_agent_test_lab_cost_v1(uuid,text,text,numeric,boolean) to service_role;
grant execute on function public.settle_agent_test_lab_cost_v1(uuid,text,numeric,text) to service_role;
grant execute on function public.claim_agent_test_lab_run_v1(uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit) values('agent-test-lab','agent-test-lab',false,20971520) on conflict(id) do nothing;

-- Run state and evidence are committed with their sanitized audit record.
create schema if not exists private;
create function private.audit_agent_test_lab_run_v1()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status and new.verdict is not distinct from old.verdict then return new; end if;
 perform public.append_operational_audit_event_v1(
   new.id,new.trace_id,null,new.target_tenant_id,'administrator',new.owner_admin_id,
   'agent.test_lab','run.'||new.status,'agent_test_lab_run',new.id::text,
   case when new.status='failed' then 'error' when new.status='cancelled' then 'cancelled'
     when new.status='completed' then 'completed' when new.status='queued' then 'pending' else 'running' end,
   case when new.status='failed' then 'error' else 'info' end,false,new.target_channel,null,0,1,new.result_code,null,
   jsonb_build_object('runId',new.id),jsonb_build_object('mode',new.mode,'verdict',new.verdict),new.deployed_sha
 );
 return new;
end $fn$;
revoke all on function private.audit_agent_test_lab_run_v1() from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.audit_agent_test_lab_run_v1() to service_role;
create trigger audit_agent_test_lab_run after insert or update on public.agent_test_lab_runs
for each row execute function private.audit_agent_test_lab_run_v1();
