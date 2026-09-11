-- Additive laboratory-only controls. Existing customer authorization is unchanged.
alter table public.agent_test_lab_steps add column dispatch_authorized_at timestamptz;

create function public.authorize_agent_test_lab_step_dispatch_v3(p_run_id uuid,p_step_id uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id for update;
 if not found or p_claim is null or r.claim_token is distinct from p_claim or r.claim_expires_at is null
   or r.claim_expires_at<=now() or r.deadline_at<=now() or r.status<>'running' then return false; end if;
 if not exists(select 1 from public.admin_users where id=r.owner_admin_id and id='admin-renato-lagares' and active and role='super_admin') then return false; end if;
 if not exists(select 1 from public.agent_test_lab_connections where id=r.sender_connection_id and owner_admin_id=r.owner_admin_id
   and purpose='sender' and instance_name like 'mychatcrm-lab-sender-%' and state='open' and archived_at is null and wa_jid=r.tester_jid) then return false; end if;
 if not exists(select 1 from public.agent_test_lab_destinations where owner_admin_id=r.owner_admin_id
   and tenant_id=r.target_tenant_id and connection_id=r.target_connection_id and channel=r.target_channel
   and target_jid=r.target_jid and revoked_at is null) then return false; end if;
 update public.agent_test_lab_steps set dispatch_authorized_at=now() where id=p_step_id and run_id=p_run_id
   and status='dispatching' and dispatch_started_at is not null and confirmed_at is null and dispatch_authorized_at is null;
 return found;
end $fn$;
revoke all on function public.authorize_agent_test_lab_step_dispatch_v3(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_agent_test_lab_step_dispatch_v3(uuid,uuid,uuid) to service_role;

create function public.reserve_agent_test_lab_ai_cost_v3(
 p_run_id uuid,p_claim uuid,p_key text,p_category text,p_reserve numeric)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id for update;
 if not found then return jsonb_build_object('ok',false,'code','run_missing'); end if;
 if not exists(select 1 from public.admin_users where id=r.owner_admin_id
   and id='admin-renato-lagares' and active and role='super_admin') then
   return jsonb_build_object('ok',false,'code','owner_inactive'); end if;
 if p_claim is null or r.claim_token is distinct from p_claim or r.claim_expires_at is null
   or r.claim_expires_at<=now() or r.deadline_at<=now()
   or r.status not in ('running','waiting_reply') then
   return jsonb_build_object('ok',false,'code','claim_invalid'); end if;
 if p_category is null or p_category not in ('tester_ai','agent_ai','evaluator_ai')
   or p_reserve is null or p_reserve<=0 or p_reserve::text in ('NaN','Infinity','-Infinity')
   or p_key is null or length(p_key)>200 or p_key not like 'lab-ai:'||p_run_id::text||':%' then
   raise exception 'invalid_reservation'; end if;
 if exists(select 1 from public.agent_test_lab_costs where operation_key=p_key) then
   return jsonb_build_object('ok',false,'code','operation_already_reserved'); end if;
 if r.spent_brl+r.reserved_brl+p_reserve>r.budget_brl then
   return jsonb_build_object('ok',false,'code','budget_exhausted'); end if;
 insert into public.agent_test_lab_costs(run_id,operation_key,category,reserved_brl)
 values(p_run_id,p_key,p_category,p_reserve);
 update public.agent_test_lab_runs set reserved_brl=reserved_brl+p_reserve,updated_at=now() where id=p_run_id;
 return jsonb_build_object('ok',true);
end $fn$;
revoke all on function public.reserve_agent_test_lab_ai_cost_v3(uuid,uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.reserve_agent_test_lab_ai_cost_v3(uuid,uuid,text,text,numeric) to service_role;

create function public.authorize_agent_test_lab_inbound_v3(
 p_tenant text,p_connection uuid,p_instance text,p_remote_jid text,p_occurred_at timestamptz)
returns boolean language sql stable security invoker set search_path='' as $fn$
 select exists(
   select 1 from public.agent_test_lab_runs r
   join public.agent_test_lab_isolated_agents a on a.lab_tenant_id=r.target_tenant_id and a.lab_agent_id=r.target_agent_id
     and a.owner_admin_id=r.owner_admin_id and a.archived_at is null
   join public.agent_test_lab_connections receiver on receiver.instance_name=p_instance and receiver.purpose='receiver'
     and receiver.owner_admin_id=r.owner_admin_id and receiver.archived_at is null and receiver.state='open'
   join public.agent_test_lab_connections sender on sender.id=r.sender_connection_id and sender.purpose='sender'
     and sender.owner_admin_id=r.owner_admin_id and sender.archived_at is null and sender.state='open' and sender.wa_jid=r.tester_jid
   join public.admin_users owner on owner.id=r.owner_admin_id and owner.id='admin-renato-lagares' and owner.active and owner.role='super_admin'
   join public.tenant_evolution_instances connection on connection.id=r.target_connection_id
     and connection.tenant_id=p_tenant and connection.instance_name=p_instance and connection.wa_jid=r.target_jid
   where r.target_tenant_id=p_tenant and r.target_connection_id=p_connection and r.target_channel='evolution'
     and r.request->>'targetKind'='copy' and r.tester_jid=p_remote_jid
     and p_tenant like 'tenant-lab-%' and p_instance like 'mychatcrm-lab-receiver-%'
     and not exists(select 1 from public.tenants where id=p_tenant)
     and r.status in ('running','waiting_reply','waiting_input','paused') and r.deadline_at>now()
     and p_occurred_at>=date_trunc('second',r.created_at) and p_occurred_at<=now()+interval '5 seconds'
     and p_occurred_at<=r.deadline_at
     and exists(select 1 from public.agent_test_lab_destinations d where d.owner_admin_id=r.owner_admin_id
       and d.tenant_id=p_tenant and d.connection_id=p_connection and d.channel=r.target_channel
       and d.target_jid=r.target_jid and d.revoked_at is null)
 );
$fn$;
revoke all on function public.authorize_agent_test_lab_inbound_v3(text,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.authorize_agent_test_lab_inbound_v3(text,uuid,text,text,timestamptz) to service_role;

create function public.enqueue_agent_test_lab_step_v3(
 p_run_id uuid,p_owner text,p_kind text,p_command jsonb,p_key text,p_reserve numeric)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; prior public.agent_test_lab_steps; asset public.agent_test_lab_assets;
 ordinal_next integer; new_id uuid; seconds integer; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id and owner_admin_id=p_owner for update;
 if not found then raise exception 'run_missing'; end if;
 if not exists(select 1 from public.admin_users where id=p_owner and id='admin-renato-lagares' and active and role='super_admin') then
   raise exception 'owner_inactive'; end if;
 if p_key is null or length(p_key) not between 8 and 200 or jsonb_typeof(p_command) is distinct from 'object'
   or p_kind is null or p_kind not in ('text','media','audio','image','video','document','wait') then raise exception 'invalid_step'; end if;
 select * into prior from public.agent_test_lab_steps where idempotency_key=p_key;
 if found then
   if prior.run_id<>p_run_id or prior.kind<>p_kind or prior.command<>p_command then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('ok',true,'stepId',prior.id,'ordinal',prior.ordinal,'duplicate',true);
 end if;
 if p_kind='wait' then
   if r.mode not in ('scripted','correction') then raise exception 'wait_requires_script'; end if;
   if r.status not in ('queued','running','waiting_reply','waiting_input') or r.deadline_at<=now() then
     return jsonb_build_object('ok',false,'code','run_not_active'); end if;
   if coalesce(p_command->>'waitSeconds','') !~ '^[0-9]{1,5}$' then raise exception 'invalid_wait'; end if;
   seconds:=(p_command->>'waitSeconds')::integer;
   if seconds not between 1 and 86400 or p_reserve is distinct from 0 then raise exception 'invalid_wait'; end if;
   if now()+make_interval(secs=>seconds)>r.deadline_at then
     return jsonb_build_object('ok',false,'code','wait_exceeds_deadline'); end if;
   if exists(select 1 from public.agent_test_lab_steps where run_id=p_run_id and status not in ('settled','rejected')) then
     return jsonb_build_object('ok',false,'code','previous_step_pending'); end if;
   select coalesce(max(ordinal),-1)+1 into ordinal_next from public.agent_test_lab_steps where run_id=p_run_id;
   insert into public.agent_test_lab_steps(run_id,ordinal,kind,command,idempotency_key,status,dispatch_started_at,confirmed_at)
   values(p_run_id,ordinal_next,'wait',p_command,p_key,'waiting_timer',now(),now()+make_interval(secs=>seconds)) returning id into new_id;
   update public.agent_test_lab_runs set status='running',next_step_at=now()+make_interval(secs=>seconds),updated_at=now() where id=p_run_id;
   return jsonb_build_object('ok',true,'stepId',new_id,'ordinal',ordinal_next);
 end if;
 if p_reserve is distinct from 0.05 then raise exception 'invalid_transport_reservation'; end if;
 if p_kind='text' then
   if jsonb_typeof(p_command->'text') is distinct from 'string' or length(btrim(p_command->>'text'))=0
     or length(p_command->>'text')>4000 or p_command ? 'assetId' then raise exception 'invalid_message'; end if;
 else
   if coalesce(length(p_command->>'text'),0)>1000 then raise exception 'invalid_caption'; end if;
   select * into asset from public.agent_test_lab_assets where id=(p_command->>'assetId')::uuid
     and owner_admin_id=p_owner and expires_at>now() and (run_id is null or run_id=p_run_id);
   if not found or (p_kind<>'media' and asset.kind<>p_kind) then raise exception 'asset_unavailable'; end if;
 end if;
 return public.enqueue_agent_test_lab_step_v1(p_run_id,p_owner,p_kind,p_command,p_key,p_reserve);
end $fn$;
revoke all on function public.enqueue_agent_test_lab_step_v3(uuid,text,text,jsonb,text,numeric) from public,anon,authenticated;
grant execute on function public.enqueue_agent_test_lab_step_v3(uuid,text,text,jsonb,text,numeric) to service_role;

-- These guards do nothing for customer tenants. They close the receiver/stop
-- race: a late webhook cannot create a new journey after the laboratory ends.
create function private.guard_agent_test_lab_journey_v3()
returns trigger language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; begin
 select * into r from public.agent_test_lab_runs where target_tenant_id=new.tenant_id
   and target_agent_id=new.agent_id and tester_jid=new.remote_jid and target_rule_id=new.rule_id
   and target_connection_id::text=new.connection_id and request->>'targetKind'='copy'
   and status in ('running','waiting_reply','waiting_input','paused') and deadline_at>now()
   order by created_at desc limit 1 for update;
 if not found or exists(select 1 from public.tenants where id=new.tenant_id)
   or not exists(select 1 from public.admin_users where id=r.owner_admin_id and id='admin-renato-lagares' and active and role='super_admin')
   or not exists(select 1 from public.agent_test_lab_isolated_agents a
   where a.lab_tenant_id=new.tenant_id and a.lab_agent_id=new.agent_id and a.archived_at is null
   and a.owner_admin_id=r.owner_admin_id) then raise exception 'lab_journey_run_inactive'; end if;
 return new;
end $fn$;
revoke all on function private.guard_agent_test_lab_journey_v3() from public,anon,authenticated;
grant execute on function private.guard_agent_test_lab_journey_v3() to service_role;
create trigger agent_test_lab_journey_guard_v3 before insert on public.lead_journeys
for each row when (new.tenant_id like 'tenant-lab-%') execute function private.guard_agent_test_lab_journey_v3();

-- Authorization is the irreversible dispatch boundary. A provider confirmation
-- for an already authorized message is still persisted after a stop.
create function private.guard_agent_test_lab_outbound_v3()
returns trigger language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; begin
 select * into r from public.agent_test_lab_runs where target_tenant_id=new.tenant_id
   and target_agent_id=new.agent_id and tester_jid=new.remote_jid and target_rule_id=new.rule_id
   and target_connection_id::text=new.connection_id and target_channel=new.channel
   and request->>'targetKind'='copy' and status in ('running','waiting_reply','waiting_input','paused')
   and deadline_at>now() order by created_at desc limit 1 for update;
 if not found or exists(select 1 from public.tenants where id=new.tenant_id)
   or not exists(select 1 from public.admin_users where id=r.owner_admin_id and id='admin-renato-lagares' and active and role='super_admin')
   then raise exception 'lab_outbound_run_inactive'; end if;
 if public.bind_agent_test_lab_journey_v2(r.id) is distinct from new.journey_id then
   raise exception 'lab_outbound_journey_mismatch'; end if;
 return new;
end $fn$;
revoke all on function private.guard_agent_test_lab_outbound_v3() from public,anon,authenticated;
grant execute on function private.guard_agent_test_lab_outbound_v3() to service_role;
create trigger agent_test_lab_outbound_insert_guard_v3 before insert on public.agent_outbound_outbox
for each row when (new.tenant_id like 'tenant-lab-%' and new.authorization_status='authorized')
execute function private.guard_agent_test_lab_outbound_v3();
create trigger agent_test_lab_outbound_update_guard_v3 before update of authorization_status on public.agent_outbound_outbox
for each row when (new.tenant_id like 'tenant-lab-%' and new.authorization_status='authorized' and old.authorization_status is distinct from new.authorization_status)
execute function private.guard_agent_test_lab_outbound_v3();
