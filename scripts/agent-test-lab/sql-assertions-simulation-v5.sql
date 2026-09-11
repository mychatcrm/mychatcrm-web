-- LOCAL DISPOSABLE DATABASE ONLY. No model/provider calls. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
do $test$
declare r uuid:=gen_random_uuid(); copy uuid:=gen_random_uuid(); claim uuid:=gen_random_uuid(); step uuid;
 result jsonb:='{"message":"こんにちは","reply":"はい","verdict":"passed","code":"reply_decided","description":"Dry run only","effects":[]}';
 state jsonb:='{"id":"simulation-pending-action","action":"create","timezone":"Asia/Tokyo"}';
begin
 if has_function_privilege('anon','public.begin_agent_test_lab_simulation_step_v5(uuid,uuid,integer)','EXECUTE')
 or has_function_privilege('authenticated','public.complete_agent_test_lab_simulation_step_v5(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE')
 then raise exception 'simulation_public_access'; end if;
 insert into public.agent_test_lab_isolated_agents(id,owner_admin_id,lab_tenant_id,lab_agent_id,source_tenant_id,source_agent_id,source_config_hash)
 values(copy,'admin-renato-lagares','tenant-lab-simulation-fixture','lab-a','source','a','hash');
 insert into public.agent_test_lab_runs(id,owner_admin_id,mode,status,target_tenant_id,target_agent_id,isolated_agent_id,
  deployed_sha,config_hash,scenario_hash,request,max_messages,budget_brl,deadline_at,claim_token,claim_expires_at)
 values(r,'admin-renato-lagares','simulation','running','tenant-lab-simulation-fixture','lab-a',copy,
  repeat('a',40),'hash','hash','{"targetKind":"copy","scenario":{"steps":[{},{}]}}',6,5,now()+interval '20 minutes',claim,now()+interval '90 seconds');
 begin perform public.begin_agent_test_lab_simulation_step_v5(r,gen_random_uuid(),0);raise exception 'stale_claim_allowed';
 exception when others then if sqlerrm<>'simulation_claim_invalid' then raise;end if;end;
 begin perform public.begin_agent_test_lab_simulation_step_v5(r,claim,1);raise exception 'skipped_step_allowed';
 exception when others then if sqlerrm<>'simulation_ordinal_invalid' then raise;end if;end;
 update public.agent_test_lab_runs set target_agent_id='different' where id=r;
 begin perform public.begin_agent_test_lab_simulation_step_v5(r,claim,0);raise exception 'wrong_agent_allowed';
 exception when others then if sqlerrm<>'simulation_scope_invalid' then raise;end if;end;
 update public.agent_test_lab_runs set target_agent_id='lab-a' where id=r;
 step:=public.begin_agent_test_lab_simulation_step_v5(r,claim,0);
 begin perform public.begin_agent_test_lab_simulation_step_v5(r,claim,0);raise exception 'double_model_start';
 exception when others then if sqlerrm<>'simulation_step_already_started' then raise;end if;end;
 if public.complete_agent_test_lab_simulation_step_v5(r,gen_random_uuid(),step,result,state) then raise exception 'stale_result_accepted';end if;
 begin perform public.complete_agent_test_lab_simulation_step_v5(r,claim,step,result||'{"verdict":"invented"}',state);raise exception 'invalid_result_accepted';
 exception when others then if sqlerrm<>'simulation_result_invalid' then raise;end if;end;
 if not public.complete_agent_test_lab_simulation_step_v5(r,claim,step,result,state) then raise exception 'valid_result_rejected';end if;
 if (select simulation_state->>'nextOrdinal' from public.agent_test_lab_runs where id=r)<>'1' then raise exception 'ordinal_not_advanced';end if;
 if (select simulation_state->'pendingAction' from public.agent_test_lab_runs where id=r)<>state then raise exception 'proposal_lost';end if;
 if (select status from public.agent_test_lab_runs where id=r)<>'running' then raise exception 'premature_complete';end if;
 if (select count(*) from public.agent_test_lab_messages where run_id=r)<>2 then raise exception 'transcript_missing';end if;
 if public.complete_agent_test_lab_simulation_step_v5(r,claim,step,result,state) then raise exception 'duplicate_complete';end if;
 claim:=(public.claim_agent_test_lab_run_v1(r)->>'claimToken')::uuid;
 step:=public.begin_agent_test_lab_simulation_step_v5(r,claim,1);
 update public.agent_test_lab_runs set status='paused',claim_token=null,claim_expires_at=null where id=r;
 if public.complete_agent_test_lab_simulation_step_v5(r,claim,step,result,state) then raise exception 'paused_result_accepted';end if;
 update public.agent_test_lab_runs set status='running',claim_token=null,claim_expires_at=null where id=r;
 -- Interrupted paid work must become inconclusive, never reissued automatically.
 claim:=(public.claim_agent_test_lab_run_v1(r)->>'claimToken')::uuid;
 if (select status from public.agent_test_lab_runs where id=r)<>'stopping' then raise exception 'interrupted_call_replayed';end if;
 -- Independently verify the final atomic commit and retention (no model call).
 update public.agent_test_lab_runs set status='running' where id=r;
 if not public.complete_agent_test_lab_simulation_step_v5(r,claim,step,result||'{"verdict":"inconclusive"}',null) then raise exception 'final_result_rejected';end if;
 if (select status||':'||verdict from public.agent_test_lab_runs where id=r)<>'completed:inconclusive' then raise exception 'false_pass';end if;
 if (select count(*) from public.agent_test_lab_messages where run_id=r)<>4 then raise exception 'duplicate_or_missing_transcript';end if;
 update public.agent_test_lab_runs set request='{}' where id=r;
 if (select simulation_state from public.agent_test_lab_runs where id=r)<>'{}'::jsonb then raise exception 'private_draft_retained';end if;
end $test$;
rollback;
