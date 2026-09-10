-- LOCAL DISPOSABLE DATABASE ONLY. Every assertion rolls back its fixtures.
\set ON_ERROR_STOP on
begin;
do $test$
declare r uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); j uuid:=gen_random_uuid();
 rule uuid:=gen_random_uuid(); isolation uuid:=gen_random_uuid(); claim uuid:=gen_random_uuid(); result jsonb;
begin
 if has_function_privilege('anon','public.stop_agent_test_lab_automation_v2(uuid,uuid)','EXECUTE')
   or has_function_privilege('authenticated','public.bind_agent_test_lab_journey_v2(uuid)','EXECUTE') then raise exception 'public_rpc_access'; end if;
 insert into public.agent_test_lab_isolated_agents(id,owner_admin_id,lab_tenant_id,lab_agent_id,source_tenant_id,source_agent_id,source_config_hash)
 values(isolation,'admin-renato-lagares','tenant-lab-safety','lab-a','source','a','hash');
 insert into public.agent_test_lab_runs(id,owner_admin_id,mode,status,target_tenant_id,target_agent_id,target_connection_id,target_rule_id,target_channel,
 tester_jid,isolated_agent_id,deployed_sha,config_hash,scenario_hash,request,max_messages,budget_brl,deadline_at,claim_token,claim_expires_at)
 values(r,'admin-renato-lagares','scripted','running','tenant-lab-safety','lab-a',c,rule,'evolution','15550000001@s.whatsapp.net',
 isolation,repeat('a',40),'hash','hash','{"targetKind":"copy"}',5,5,now()+interval '1 hour',claim,now()+interval '1 minute');
 if public.bind_agent_test_lab_journey_v2(r) is not null then raise exception 'invented_journey'; end if;
 insert into public.lead_distribution_rules values(rule,'tenant-lab-safety','evolution');
 insert into public.lead_journeys values(j,'tenant-lab-safety','15550000001@s.whatsapp.net','lab-a',rule,c::text,now()+interval '1 second');
 insert into public.conversation_states values('tenant-lab-safety','15550000001@s.whatsapp.net','whatsapp',j,null,4);
 update public.lead_journeys set created_at=now()-interval '1 day' where id=j;
 begin perform public.bind_agent_test_lab_journey_v2(r); raise exception 'accepted_old_journey';
 exception when others then if sqlerrm<>'lab_journey_mismatch' then raise; end if; end;
 update public.lead_journeys set created_at=now()+interval '1 second',agent_id='other' where id=j;
 begin perform public.bind_agent_test_lab_journey_v2(r); raise exception 'accepted_other_agent';
 exception when others then if sqlerrm<>'lab_journey_mismatch' then raise; end if; end;
 update public.lead_journeys set agent_id='lab-a' where id=j;
 update public.lead_distribution_rules set transport='cloud_api' where id=rule;
 begin perform public.bind_agent_test_lab_journey_v2(r); raise exception 'accepted_other_channel';
 exception when others then if sqlerrm<>'lab_journey_mismatch' then raise; end if; end;
 update public.lead_distribution_rules set transport='evolution' where id=rule;
 if public.bind_agent_test_lab_journey_v2(r)<>j then raise exception 'exact_journey_not_bound'; end if;
 begin perform public.stop_agent_test_lab_automation_v2(r,gen_random_uuid()); raise exception 'accepted_stale_claim';
 exception when others then if sqlerrm<>'lab_stop_claim_stale' then raise; end if; end;
 update public.agent_test_lab_runs set request='{"targetKind":"original"}' where id=r;
 begin perform public.stop_agent_test_lab_automation_v2(r,claim); raise exception 'stopped_original';
 exception when others then if sqlerrm<>'lab_stop_isolated_only' then raise; end if; end;
 update public.agent_test_lab_runs set request='{"targetKind":"copy"}' where id=r;
 insert into public.tenants values('tenant-lab-safety');
 begin perform public.stop_agent_test_lab_automation_v2(r,claim); raise exception 'stopped_customer';
 exception when others then if sqlerrm<>'lab_stop_isolated_only' then raise; end if; end;
 delete from public.tenants where id='tenant-lab-safety';
 update public.conversation_states set active_journey_id=gen_random_uuid();
 begin perform public.stop_agent_test_lab_automation_v2(r,claim); raise exception 'stopped_new_journey';
 exception when others then if sqlerrm not in ('lab_stop_journey_mismatch','lab_journey_mismatch') then raise; end if; end;
 update public.conversation_states set active_journey_id=j;
 perform public.stop_agent_test_lab_automation_v2(r,claim);
 if (select count(*) from public.lab_stop_calls)<>1 then raise exception 'takeover_not_called_exactly_once'; end if;
 result:=public.control_agent_test_lab_run_v1(r,'admin-renato-lagares','manual');
 if (select mode from public.agent_test_lab_runs where id=r)<>'manual' then raise exception 'autonomy_not_revoked'; end if;
 if (select claim_token from public.agent_test_lab_runs where id=r) is not null then raise exception 'claim_not_revoked'; end if;
 -- Content cleanup cannot orphan storage, and scrubs scenario/command text too.
 update public.agent_test_lab_runs set status='completed',created_at=now()-interval '100 days' where id=r;
 insert into public.agent_test_lab_steps(run_id,ordinal,kind,command,idempotency_key) values(r,0,'text','{"text":"private"}','retention-safety');
 insert into public.agent_test_lab_assets(owner_admin_id,run_id,storage_path,kind,mime_type,byte_size,filename,checksum)
 values('admin-renato-lagares',r,'admin-renato-lagares/safety','document','text/plain',1,'private.txt','hash');
 perform public.purge_agent_test_lab_content_v1();
 if not exists(select 1 from public.agent_test_lab_assets where run_id=r) then raise exception 'orphaned_storage'; end if;
 if not exists(select 1 from public.agent_test_lab_runs where id=r and request='{}'::jsonb) then raise exception 'parent_deleted_or_private_request_retained'; end if;
 if exists(select 1 from public.agent_test_lab_steps where run_id=r and command<>'{}'::jsonb) then raise exception 'private_command_retained'; end if;
end $test$;
rollback;
