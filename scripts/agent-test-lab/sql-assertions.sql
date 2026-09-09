\set ON_ERROR_STOP on
begin;
insert into public.agent_test_lab_runs(id,owner_admin_id,mode,deployed_sha,config_hash,scenario_hash,request,max_messages,budget_brl,deadline_at)
values('11111111-1111-4111-8111-111111111111','admin-renato-lagares','internal',repeat('a',40),'config','scenario','{}',2,5,now()+interval '20 minutes');
set local role service_role;
do $test$ declare c jsonb; ok boolean; begin
 c:=public.claim_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111');
 if c->>'claimToken' is null then raise exception 'first claim failed'; end if;
 if public.claim_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111') is not null then raise exception 'duplicate claim'; end if;
 if not public.heartbeat_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111',(c->>'claimToken')::uuid) then raise exception 'heartbeat failed'; end if;
 if (public.reserve_agent_test_lab_cost_v1('11111111-1111-4111-8111-111111111111','first','tester_ai',3,true)->>'ok')::boolean is not true then raise exception 'reservation failed'; end if;
 if (public.reserve_agent_test_lab_cost_v1('11111111-1111-4111-8111-111111111111','second','tester_ai',3,true)->>'ok')::boolean then raise exception 'over budget accepted'; end if;
 if (public.reserve_agent_test_lab_cost_v1('11111111-1111-4111-8111-111111111111','first','tester_ai',0,true)->>'ok')::boolean then raise exception 'duplicate charged'; end if;
 if not public.settle_agent_test_lab_cost_v1('11111111-1111-4111-8111-111111111111','first',1,null) then raise exception 'settlement failed'; end if;
 if public.settle_agent_test_lab_cost_v1('11111111-1111-4111-8111-111111111111','first',1,null) then raise exception 'settlement duplicated'; end if;
 perform public.control_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111','admin-renato-lagares','pause');
 if public.heartbeat_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111',(c->>'claimToken')::uuid) then raise exception 'stale heartbeat accepted'; end if;
 if (public.reserve_agent_test_lab_cost_v1('11111111-1111-4111-8111-111111111111','paused','tester_ai',0,true)->>'ok')::boolean then raise exception 'paused action accepted'; end if;
 perform public.control_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111','admin-renato-lagares','resume');
 if public.claim_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111') is null then raise exception 'resume failed'; end if;
end $test$;
reset role;
update public.agent_test_lab_runs set deadline_at=now()-interval '1 second',claim_expires_at=now()-interval '1 second' where id='11111111-1111-4111-8111-111111111111';
set local role service_role;
do $test$ begin
 if public.claim_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111') is null then raise exception 'expired run cannot be cleaned'; end if;
 if (select status from public.agent_test_lab_runs where id='11111111-1111-4111-8111-111111111111')<>'stopping' then raise exception 'deadline not enforced'; end if;
 if has_table_privilege('anon','public.agent_test_lab_runs','SELECT') or has_table_privilege('authenticated','public.agent_test_lab_sessions','SELECT') then raise exception 'public data leak'; end if;
 if has_function_privilege('anon','public.claim_agent_test_lab_run_v1(uuid)','EXECUTE') then raise exception 'public rpc leak'; end if;
 if not public.consume_agent_test_lab_rate_v1('fixture',1,60) or public.consume_agent_test_lab_rate_v1('fixture',1,60) then raise exception 'rate limit failed'; end if;
 if public.arm_agent_test_lab_step_v1('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',null) then raise exception 'missing lease authorized'; end if;
end $test$;
reset role;
update public.agent_test_lab_runs set status='paused',claim_token=null,claim_expires_at=null,deadline_at=now()-interval '1 second' where id='11111111-1111-4111-8111-111111111111';
set local role service_role;
do $test$ begin
 if public.claim_agent_test_lab_run_v1('11111111-1111-4111-8111-111111111111') is null then raise exception 'paused expired run not recovered'; end if;
 if (select status from public.agent_test_lab_runs where id='11111111-1111-4111-8111-111111111111')<>'stopping' then raise exception 'paused deadline not enforced'; end if;
end $test$;
reset role;
do $test$ begin
 if (select count(*) from public.lab_test_audit_log where run_id='11111111-1111-4111-8111-111111111111')<4 then raise exception 'transactional audit missing'; end if;
end $test$;
rollback;
