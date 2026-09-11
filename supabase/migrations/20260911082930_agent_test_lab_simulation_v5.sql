-- Private durable dry-run state. No customer history or appointments are mutated.
alter table public.agent_test_lab_runs add column simulation_state jsonb not null default '{}';

create function public.begin_agent_test_lab_simulation_step_v5(p_run uuid,p_claim uuid,p_ordinal integer)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.agent_test_lab_runs; step_id uuid;
begin
 select * into r from public.agent_test_lab_runs where id=p_run for update;
 if not found or r.mode<>'simulation' or r.status<>'running' or r.claim_token is distinct from p_claim or p_claim is null
   or r.claim_expires_at is null or r.claim_expires_at<=now() or r.deadline_at<=now() then raise exception 'simulation_claim_invalid'; end if;
 if not exists(select 1 from public.admin_users where id=r.owner_admin_id and id='admin-renato-lagares' and active and role='super_admin')
   or not exists(select 1 from public.agent_test_lab_isolated_agents a where a.id=r.isolated_agent_id and a.lab_tenant_id=r.target_tenant_id
     and a.lab_agent_id=r.target_agent_id and a.owner_admin_id=r.owner_admin_id and a.archived_at is null)
   or r.request->>'targetKind' is distinct from 'copy' or r.target_tenant_id not like 'tenant-lab-%'
   or exists(select 1 from public.tenants where id=r.target_tenant_id) then raise exception 'simulation_scope_invalid'; end if;
 if jsonb_typeof(r.request#>'{scenario,steps}') is distinct from 'array' then raise exception 'simulation_scenario_invalid'; end if;
 if p_ordinal is null or p_ordinal<0 or p_ordinal>=jsonb_array_length(r.request#>'{scenario,steps}')
   or p_ordinal<>coalesce((r.simulation_state->>'nextOrdinal')::integer,0) then raise exception 'simulation_ordinal_invalid'; end if;
 if exists(select 1 from public.agent_test_lab_steps where run_id=p_run and ordinal=p_ordinal) then raise exception 'simulation_step_already_started'; end if;
 insert into public.agent_test_lab_steps(run_id,ordinal,kind,command,idempotency_key,status,dispatch_started_at)
 values(p_run,p_ordinal,'simulation',jsonb_build_object('ordinal',p_ordinal),'lab-simulation:'||p_run||':'||p_ordinal,'dispatching',now()) returning id into step_id;
 return step_id;
end $$;

create function public.complete_agent_test_lab_simulation_step_v5(p_run uuid,p_claim uuid,p_step uuid,p_result jsonb,p_pending jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.agent_test_lab_runs; s public.agent_test_lab_steps; n integer; aggregate_verdict text;
begin
 select * into r from public.agent_test_lab_runs where id=p_run for update;
 if not found or r.mode<>'simulation' or r.status<>'running' or p_claim is null or r.claim_token is distinct from p_claim
   or r.claim_expires_at is null or r.claim_expires_at<=now() or r.deadline_at<=now() then return false; end if;
 if not exists(select 1 from public.admin_users where id=r.owner_admin_id and id='admin-renato-lagares' and active and role='super_admin') then return false; end if;
 select * into s from public.agent_test_lab_steps where id=p_step and run_id=p_run and kind='simulation' and status='dispatching' for update;
 if not found then return false; end if;
 if s.ordinal<>coalesce((r.simulation_state->>'nextOrdinal')::integer,0) then return false; end if;
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>200000
   or jsonb_typeof(p_result->'message') is distinct from 'string' or jsonb_typeof(p_result->'reply') is distinct from 'string'
   or length(p_result->>'message')>20000 or length(p_result->>'reply')>20000
   or (p_result->>'verdict') is null or (p_result->>'verdict') not in ('passed','failed','expected_block','inconclusive','not_executed')
   or coalesce(p_result->>'code','') !~ '^[a-zA-Z0-9_:]{1,100}$'
   or jsonb_typeof(p_result->'description') is distinct from 'string' or length(p_result->>'description')>2000
   or jsonb_typeof(p_result->'effects') is distinct from 'array'
   or (p_pending is not null and p_pending<>'null'::jsonb and (jsonb_typeof(p_pending)<>'object' or octet_length(p_pending::text)>10000))
   then raise exception 'simulation_result_invalid'; end if;
 insert into public.agent_test_lab_messages(run_id,direction,kind,content,provider_message_id,provider_occurred_at)
 values(p_run,'tester','text',p_result->>'message','sim:'||s.ordinal||':tester',now()),
 (p_run,'agent','text',p_result->>'reply','sim:'||s.ordinal||':agent',now());
 insert into public.agent_test_lab_evidence(run_id,check_code,verdict,description,resource_ids)
 values(p_run,'step_'||s.ordinal,p_result->>'verdict',left(coalesce(p_result->>'description',''),2000),jsonb_build_array(p_step));
 insert into public.agent_test_lab_effects(run_id,effect_type,resource_table,resource_id,details)
 values(p_run,'simulation_decision','simulation',s.ordinal::text,jsonb_build_object('effects',p_result->'effects'));
 update public.agent_test_lab_steps set status='settled',confirmed_at=now(),result_code=p_result->>'code' where id=p_step;
 n:=s.ordinal+1;
 select case when bool_or(e.verdict='failed') then 'failed' when bool_or(e.verdict='inconclusive') then 'inconclusive'
   when bool_or(e.verdict='not_executed') then 'not_executed' else 'passed' end into aggregate_verdict
 from public.agent_test_lab_evidence e where run_id=p_run;
 update public.agent_test_lab_runs set simulation_state=jsonb_build_object('nextOrdinal',n,'pendingAction',p_pending),
   status=case when n>=jsonb_array_length(r.request#>'{scenario,steps}') then case when aggregate_verdict='failed' then 'failed' else 'completed' end else 'running' end,
   verdict=case when n>=jsonb_array_length(r.request#>'{scenario,steps}') then aggregate_verdict else 'not_executed' end,
   result_code=p_result->>'code',claim_token=null,claim_expires_at=null,next_step_at=now(),updated_at=now(),
   finished_at=case when n>=jsonb_array_length(r.request#>'{scenario,steps}') then now() else null end where id=p_run;
 return true;
end $$;
revoke all on function public.begin_agent_test_lab_simulation_step_v5(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.complete_agent_test_lab_simulation_step_v5(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.begin_agent_test_lab_simulation_step_v5(uuid,uuid,integer) to service_role;
grant execute on function public.complete_agent_test_lab_simulation_step_v5(uuid,uuid,uuid,jsonb,jsonb) to service_role;

-- The existing 30-day purge clears the scenario. Its private draft must expire
-- in the same transaction, including when old versions execute the purge.
create function private.purge_agent_test_lab_simulation_state_v5()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.request='{}'::jsonb and new.status in ('completed','failed','cancelled') then
  new.simulation_state:='{}'::jsonb;
 end if;
 return new;
end $$;
revoke all on function private.purge_agent_test_lab_simulation_state_v5() from public,anon,authenticated;
create trigger agent_test_lab_simulation_retention_v5 before update of request on public.agent_test_lab_runs
 for each row execute function private.purge_agent_test_lab_simulation_state_v5();
