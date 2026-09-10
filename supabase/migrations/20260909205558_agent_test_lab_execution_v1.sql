-- Execution layer for the owner-operated laboratory. Additive: every object is new
-- and named agent_test_lab_*. No existing table, function or policy is altered.

-- The isolated copy lives outside public.tenants, exactly like tenant-system-internal
-- already does: no FK, no row in the customer table, no effect on platform metrics.
create table public.agent_test_lab_isolated_agents (
 id uuid primary key default gen_random_uuid(), owner_admin_id text not null,
 lab_tenant_id text not null, lab_agent_id text not null,
 source_tenant_id text not null, source_agent_id text not null,
 source_config_hash text not null, unavailable_dependencies jsonb not null default '[]',
 created_at timestamptz not null default now(), archived_at timestamptz,
 unique(lab_tenant_id, lab_agent_id)
);
create unique index agent_test_lab_isolated_source on public.agent_test_lab_isolated_agents(source_tenant_id,source_agent_id)
 where archived_at is null;

-- Effects the run actually caused, confirmed against the database rather than the reply text.
create table public.agent_test_lab_effects (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.agent_test_lab_runs(id),
 effect_type text not null, observed_at timestamptz not null default now(),
 resource_table text, resource_id text, details jsonb not null default '{}',
 unique(run_id, effect_type, resource_table, resource_id)
);
create index agent_test_lab_effects_run on public.agent_test_lab_effects(run_id);

alter table public.agent_test_lab_runs add column isolated_agent_id uuid references public.agent_test_lab_isolated_agents(id);
alter table public.agent_test_lab_runs add column target_form_id text;
alter table public.agent_test_lab_runs add column effects_baseline jsonb not null default '{}';

do $permissions$ declare t text; begin
 foreach t in array array['isolated_agents','effects'] loop
   execute format('alter table public.%I enable row level security','agent_test_lab_'||t);
   execute format('revoke all on public.%I from public,anon,authenticated','agent_test_lab_'||t);
   execute format('grant select,insert,update,delete on public.%I to service_role','agent_test_lab_'||t);
 end loop;
end $permissions$;

-- A destination becomes usable only through an explicit, owner-confirmed row.
-- The tester number and the answering number must differ, and both are recorded.
create function public.confirm_agent_test_lab_destination_v1(
 p_owner text, p_tenant_id text, p_connection_id uuid, p_channel text, p_target_jid text, p_sender_jid text)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare d public.agent_test_lab_destinations; begin
 if not exists(select 1 from public.admin_users where id=p_owner and id='admin-renato-lagares' and active and role='super_admin') then
   raise exception 'owner_inactive'; end if;
 if p_target_jid is null or p_sender_jid is null or p_target_jid=p_sender_jid then raise exception 'same_number_rejected'; end if;
 if p_channel not in ('evolution','meta_cloud') then raise exception 'invalid_channel'; end if;
 insert into public.agent_test_lab_destinations(owner_admin_id,tenant_id,connection_id,channel,target_jid)
 values(p_owner,p_tenant_id,p_connection_id,p_channel,p_target_jid)
 on conflict(owner_admin_id,tenant_id,connection_id,channel,target_jid)
 do update set confirmed_at=now(), revoked_at=null
 returning * into d;
 return jsonb_build_object('id',d.id,'confirmedAt',d.confirmed_at);
end $fn$;
revoke all on function public.confirm_agent_test_lab_destination_v1(text,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.confirm_agent_test_lab_destination_v1(text,text,uuid,text,text,text) to service_role;

-- Queue one tester action. Limits, budget and destination are checked in the same
-- transaction that creates the step, so no paid or outbound action can slip past them.
create function public.enqueue_agent_test_lab_step_v1(
 p_run_id uuid, p_owner text, p_kind text, p_command jsonb, p_key text, p_reserve numeric)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; next_ordinal integer; new_id uuid; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id and owner_admin_id=p_owner for update;
 if not found then raise exception 'run_missing'; end if;
 if not exists(select 1 from public.admin_users where id=p_owner and id='admin-renato-lagares' and active and role='super_admin') then
   raise exception 'owner_inactive'; end if;
 if r.mode not in ('manual','scripted','autonomous','correction') then raise exception 'mode_not_interactive'; end if;
 if r.status not in ('running','waiting_reply','waiting_input','queued') then return jsonb_build_object('ok',false,'code','run_not_active'); end if;
 if r.deadline_at<=now() then return jsonb_build_object('ok',false,'code','deadline_reached'); end if;
 if r.sent_messages>=r.max_messages then return jsonb_build_object('ok',false,'code','message_limit'); end if;
 if r.spent_brl+r.reserved_brl+p_reserve>r.budget_brl then return jsonb_build_object('ok',false,'code','budget_exhausted'); end if;
 -- The authorized destination is re-read here, not trusted from the run row alone.
 if not exists(select 1 from public.agent_test_lab_destinations
   where owner_admin_id=p_owner and tenant_id=r.target_tenant_id and connection_id=r.target_connection_id
     and channel=r.target_channel and target_jid=r.target_jid and revoked_at is null) then
   return jsonb_build_object('ok',false,'code','destination_not_authorized'); end if;
 if exists(select 1 from public.agent_test_lab_steps where run_id=p_run_id and dispatch_started_at is not null and confirmed_at is null) then
   return jsonb_build_object('ok',false,'code','provider_receipt_unknown'); end if;
 -- A repeated key is a retry of the same intent, not a second message.
 if exists(select 1 from public.agent_test_lab_steps where idempotency_key=p_key) then
   return jsonb_build_object('ok',false,'code','step_already_queued'); end if;
 select coalesce(max(ordinal),-1)+1 into next_ordinal from public.agent_test_lab_steps where run_id=p_run_id;
 insert into public.agent_test_lab_costs(run_id,operation_key,category,reserved_brl)
 values(p_run_id,p_key,'transport',p_reserve);
 insert into public.agent_test_lab_steps(run_id,ordinal,kind,command,idempotency_key)
 values(p_run_id,next_ordinal,p_kind,p_command,p_key) returning id into new_id;
 update public.agent_test_lab_runs
   set sent_messages=sent_messages+1, reserved_brl=reserved_brl+p_reserve,
       status=case when status in ('queued','waiting_reply','waiting_input') then 'running' else status end,
       next_step_at=now(), updated_at=now()
 where id=p_run_id;
 return jsonb_build_object('ok',true,'stepId',new_id,'ordinal',next_ordinal);
end $fn$;
revoke all on function public.enqueue_agent_test_lab_step_v1(uuid,text,text,jsonb,text,numeric) from public,anon,authenticated;
grant execute on function public.enqueue_agent_test_lab_step_v1(uuid,text,text,jsonb,text,numeric) to service_role;

-- Stops every run the owner has open. Delivered messages and confirmed
-- appointments are never undone here; only future tester actions are blocked.
create function public.stop_all_agent_test_lab_runs_v1(p_owner text)
returns integer language plpgsql security invoker set search_path='' as $fn$
declare n integer; begin
 if not exists(select 1 from public.admin_users where id=p_owner and id='admin-renato-lagares' and active and role='super_admin') then
   raise exception 'owner_inactive'; end if;
 with stopped as (
   update public.agent_test_lab_runs set status='stopping', result_code=coalesce(result_code,'stop_all_requested'),
     claim_token=null, claim_expires_at=null, next_step_at=now(), updated_at=now()
   where owner_admin_id=p_owner and status in ('queued','running','paused','waiting_reply','waiting_input')
   returning id
 ) select count(*) into n from stopped;
 return n;
end $fn$;
revoke all on function public.stop_all_agent_test_lab_runs_v1(text) from public,anon,authenticated;
grant execute on function public.stop_all_agent_test_lab_runs_v1(text) to service_role;

-- Retention: laboratory conversations and files for 30 days, sanitized results for 90.
-- Evidence and audit rows survive; only test content is removed.
create function public.purge_agent_test_lab_content_v1()
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare messages integer; assets integer; runs integer; expired uuid[]; begin
 with removed as (
   delete from public.agent_test_lab_messages m using public.agent_test_lab_runs r
   where m.run_id=r.id and r.created_at<now()-interval '30 days' returning m.id
 ) select count(*) into messages from removed;
 with removed as (
   delete from public.agent_test_lab_assets where created_at<now()-interval '30 days' returning id
 ) select count(*) into assets from removed;
 -- Children first: every table referencing a run must be cleared before the run row.
 select array_agg(id) into expired from public.agent_test_lab_runs
   where created_at<now()-interval '90 days' and status in ('completed','failed','cancelled');
 if expired is null then return jsonb_build_object('messages',messages,'assets',assets,'runs',0); end if;
 delete from public.agent_test_lab_messages where run_id=any(expired);
 delete from public.agent_test_lab_assets where run_id=any(expired);
 delete from public.agent_test_lab_effects where run_id=any(expired);
 delete from public.agent_test_lab_evidence where run_id=any(expired);
 delete from public.agent_test_lab_resources where run_id=any(expired);
 delete from public.agent_test_lab_costs where run_id=any(expired);
 delete from public.agent_test_lab_steps where run_id=any(expired);
 with removed as (delete from public.agent_test_lab_runs where id=any(expired) returning id)
 select count(*) into runs from removed;
 return jsonb_build_object('messages',messages,'assets',assets,'runs',runs);
end $fn$;
revoke all on function public.purge_agent_test_lab_content_v1() from public,anon,authenticated;
grant execute on function public.purge_agent_test_lab_content_v1() to service_role;
