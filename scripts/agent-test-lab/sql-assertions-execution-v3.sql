-- LOCAL DISPOSABLE DATABASE ONLY. Every fixture rolls back.
\set ON_ERROR_STOP on
begin;
do $test$
declare r uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); sender uuid:=gen_random_uuid(); receiver uuid:=gen_random_uuid();
 token uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid(); result jsonb; amount numeric; n integer;
 journey uuid:=gen_random_uuid(); rule uuid:=gen_random_uuid(); outbound uuid:=gen_random_uuid(); step uuid;
 jid text:='447700900001@s.whatsapp.net'; dest text:='447700900002@s.whatsapp.net'; owner text:='admin-renato-lagares';
begin
 if has_function_privilege('anon','public.enqueue_agent_test_lab_step_v3(uuid,text,text,jsonb,text,numeric)','EXECUTE')
   or has_function_privilege('authenticated','public.reserve_agent_test_lab_ai_cost_v3(uuid,uuid,text,text,numeric)','EXECUTE')
   or has_function_privilege('anon','public.authorize_agent_test_lab_inbound_v3(text,uuid,text,text,timestamptz)','EXECUTE') then
   raise exception 'rpc_public_access'; end if;
 insert into public.agent_test_lab_isolated_agents(owner_admin_id,lab_tenant_id,lab_agent_id,source_tenant_id,source_agent_id,source_config_hash)
 values(owner,'tenant-lab-v3','lab-a','source','a','hash');
 insert into public.agent_test_lab_connections(id,owner_admin_id,purpose,instance_name,state,wa_jid,webhook_secret_hash)
 values(sender,owner,'sender','mychatcrm-lab-sender-fixture','open',jid,'hash'),
 (receiver,owner,'receiver','mychatcrm-lab-receiver-fixture','open',dest,'hash');
 insert into public.tenant_evolution_instances values(c,'tenant-lab-v3','mychatcrm-lab-receiver-fixture',dest);
 insert into public.agent_test_lab_runs(id,owner_admin_id,mode,status,sender_connection_id,target_tenant_id,target_agent_id,
 target_connection_id,target_channel,target_jid,tester_jid,deployed_sha,config_hash,scenario_hash,request,
 max_messages,budget_brl,deadline_at,claim_token,claim_expires_at)
 values(r,owner,'scripted','running',sender,'tenant-lab-v3','lab-a',c,'evolution',dest,jid,repeat('a',40),'hash','hash',
 '{"targetKind":"copy"}',2,5,now()+interval '20 minutes',token,now()+interval '90 seconds');
 insert into public.agent_test_lab_destinations(owner_admin_id,tenant_id,connection_id,channel,target_jid)
 values(owner,'tenant-lab-v3',c,'evolution',dest);
 if not public.authorize_agent_test_lab_inbound_v3('tenant-lab-v3',c,'mychatcrm-lab-receiver-fixture',jid,now()) then raise exception 'valid_intake_refused'; end if;
 if public.authorize_agent_test_lab_inbound_v3('tenant-lab-v3',c,'mychatcrm-lab-receiver-fixture','447700900003@s.whatsapp.net',now()) then raise exception 'foreign_contact_imported'; end if;
 if public.authorize_agent_test_lab_inbound_v3('tenant-lab-v3',c,'mychatcrm-lab-receiver-fixture',jid,now()-interval '1 day') then raise exception 'history_imported'; end if;
 if public.authorize_agent_test_lab_inbound_v3('tenant-lab-v3',c,'mychatcrm-lab-receiver-fixture',jid,now()+interval '1 day') then raise exception 'future_imported'; end if;
 update public.agent_test_lab_runs set target_rule_id=rule where id=r;
 insert into public.lead_distribution_rules values(rule,'tenant-lab-v3','evolution');
 insert into public.lead_journeys values(journey,'tenant-lab-v3',jid,'lab-a',rule,c::text,now());
 insert into public.conversation_states values('tenant-lab-v3',jid,'whatsapp',journey,null,0);
 insert into public.agent_outbound_outbox values(outbound,'tenant-lab-v3','lab-a',jid,rule,c::text,'evolution',journey,'authorized','dispatching');
 update public.agent_test_lab_runs set status='stopping' where id=r;
 begin insert into public.lead_journeys values(gen_random_uuid(),'tenant-lab-v3',jid,'lab-a',rule,c::text,now()); raise exception 'late_journey_after_stop';
 exception when others then if sqlerrm<>'lab_journey_run_inactive' then raise; end if; end;
 begin insert into public.agent_outbound_outbox values(gen_random_uuid(),'tenant-lab-v3','lab-a',jid,rule,c::text,'evolution',journey,'authorized','dispatching'); raise exception 'outbound_after_stop';
 exception when others then if sqlerrm<>'lab_outbound_run_inactive' then raise; end if; end;
 update public.agent_outbound_outbox set status='delivered' where id=outbound;
 if (select status from public.agent_outbound_outbox where id=outbound)<>'delivered' then raise exception 'lost_prior_confirmation'; end if;
 -- Customer journeys/outbounds are outside these laboratory-only triggers.
 insert into public.lead_journeys values(gen_random_uuid(),'ordinary-customer',jid,'a',rule,c::text,now());
 insert into public.agent_outbound_outbox values(gen_random_uuid(),'ordinary-customer','a',jid,rule,c::text,'evolution',journey,'authorized','dispatching');
 if public.authorize_agent_test_lab_inbound_v3('tenant-lab-v3',c,'mychatcrm-lab-receiver-fixture',jid,now()) then raise exception 'stopped_intake'; end if;
 result:=public.reserve_agent_test_lab_ai_cost_v3(r,token,'lab-ai:'||r||':stop','agent_ai',1);
 if result->>'ok'='true' then raise exception 'stopped_ai'; end if;
 update public.agent_test_lab_runs set status='running' where id=r;
 result:=public.reserve_agent_test_lab_ai_cost_v3(r,gen_random_uuid(),'lab-ai:'||r||':stale','agent_ai',1);
 if result->>'ok'='true' then raise exception 'stale_claim_ai'; end if;
 result:=public.reserve_agent_test_lab_ai_cost_v3(r,token,'lab-ai:'||r||':over','agent_ai',6);
 if result->>'code'<>'budget_exhausted' then raise exception 'unbounded_ai'; end if;
 begin perform public.reserve_agent_test_lab_ai_cost_v3(r,token,'lab-ai:'||r||':nan','agent_ai','NaN'::numeric); raise exception 'nan_budget';
 exception when others then if sqlerrm<>'invalid_reservation' then raise; end if; end;
 result:=public.reserve_agent_test_lab_ai_cost_v3(r,token,'lab-ai:'||r||':0','agent_ai',1);
 if result->>'ok'<>'true' then raise exception 'reservation_failed'; end if;
 result:=public.reserve_agent_test_lab_ai_cost_v3(r,token,'lab-ai:'||r||':0','agent_ai',1);
 if result->>'code'<>'operation_already_reserved' then raise exception 'double_ai'; end if;
 perform public.settle_agent_test_lab_cost_v1(r,'lab-ai:'||r||':0',0.25,'provider-fixture');
 if public.settle_agent_test_lab_cost_v1(r,'lab-ai:'||r||':0',0.25,'provider-fixture') then raise exception 'double_charge'; end if;
 if (select spent_brl from public.agent_test_lab_runs where id=r)<>0.25 then raise exception 'cost_missing'; end if;
 result:=public.enqueue_agent_test_lab_step_v3(r,owner,'wait','{"waitSeconds":15}','lab-wait-v3',0);
 if result->>'ok'<>'true' then raise exception 'wait_queue_failed'; end if;
 if (select sent_messages from public.agent_test_lab_runs where id=r)<>0 then raise exception 'wait_charged_message'; end if;
 if (select reserved_brl from public.agent_test_lab_runs where id=r)<>0 then raise exception 'wait_charged_money'; end if;
 if (select confirmed_at-dispatch_started_at from public.agent_test_lab_steps where run_id=r and ordinal=0)<>interval '15 seconds' then raise exception 'wait_accelerated'; end if;
 result:=public.enqueue_agent_test_lab_step_v3(r,owner,'wait','{"waitSeconds":15}','lab-wait-v3',0);
 if result->>'duplicate'<>'true' then raise exception 'wait_duplicate'; end if;
 update public.agent_test_lab_steps set status='settled' where run_id=r;
 result:=public.enqueue_agent_test_lab_step_v3(r,owner,'wait','{"waitSeconds":86400}','lab-wait-too-long-v3',0);
 if result->>'code'<>'wait_exceeds_deadline' then raise exception 'wait_exceeds_run'; end if;
 insert into public.agent_test_lab_assets(id,owner_admin_id,storage_path,kind,mime_type,byte_size,filename,checksum)
 values(asset,owner,'admin-renato-lagares/controlled','image','image/png',100,'fixture.png','hash');
 result:=public.enqueue_agent_test_lab_step_v3(r,owner,'image',jsonb_build_object('assetId',asset,'text','caption'),'lab-image-v3',0.05);
 if result->>'ok'<>'true' then raise exception 'media_queue_failed'; end if;
 result:=public.enqueue_agent_test_lab_step_v3(r,owner,'image',jsonb_build_object('assetId',asset,'text','caption'),'lab-image-v3',0.05);
 if result->>'duplicate'<>'true' then raise exception 'media_duplicate'; end if;
 step:=(result->>'stepId')::uuid;
 if not public.arm_agent_test_lab_step_v1(r,step,token) then raise exception 'step_arm_failed'; end if;
 update public.agent_test_lab_runs set status='paused' where id=r;
 if public.authorize_agent_test_lab_step_dispatch_v3(r,step,token) then raise exception 'paused_dispatch'; end if;
 update public.agent_test_lab_runs set status='running' where id=r;
 if public.authorize_agent_test_lab_step_dispatch_v3(r,step,gen_random_uuid()) then raise exception 'stale_dispatch'; end if;
 if not public.authorize_agent_test_lab_step_dispatch_v3(r,step,token) then raise exception 'dispatch_not_authorized'; end if;
 if public.authorize_agent_test_lab_step_dispatch_v3(r,step,token) then raise exception 'dispatch_authorized_twice'; end if;
 if (select sent_messages from public.agent_test_lab_runs where id=r)<>1 then raise exception 'duplicate_counter'; end if;
 begin perform public.enqueue_agent_test_lab_step_v3(r,owner,'image',jsonb_build_object('assetId',asset,'text','changed'),'lab-image-v3',0.05); raise exception 'idempotency_changed';
 exception when others then if sqlerrm<>'idempotency_conflict' then raise; end if; end;
 begin perform public.enqueue_agent_test_lab_step_v3(r,owner,'text',jsonb_build_object('text',repeat('x',4001)),'lab-long-v3',0.05); raise exception 'text_truncated';
 exception when others then if sqlerrm<>'invalid_message' then raise; end if; end;
 begin perform public.enqueue_agent_test_lab_step_v3(r,owner,'video',jsonb_build_object('assetId',asset),'lab-wrong-kind-v3',0.05); raise exception 'wrong_media_kind';
 exception when others then if sqlerrm<>'asset_unavailable' then raise; end if; end;
 update public.agent_test_lab_assets set expires_at=now()-interval '1 second' where id=asset;
 begin perform public.enqueue_agent_test_lab_step_v3(r,owner,'image',jsonb_build_object('assetId',asset),'lab-expired-v3',0.05); raise exception 'expired_asset';
 exception when others then if sqlerrm<>'asset_unavailable' then raise; end if; end;
end $test$;
rollback;
