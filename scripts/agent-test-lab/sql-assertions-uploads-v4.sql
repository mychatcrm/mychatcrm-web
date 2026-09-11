-- LOCAL DISPOSABLE DATABASE ONLY. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
do $test$
declare r uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); other_run uuid:=gen_random_uuid();
begin
 if has_function_privilege('anon','private.guard_agent_test_lab_step_asset_v4()','EXECUTE')
  or has_function_privilege('authenticated','private.guard_agent_test_lab_step_asset_v4()','EXECUTE') then
  raise exception 'public_asset_trigger_access'; end if;
 insert into public.agent_test_lab_runs(id,owner_admin_id,mode,status,deployed_sha,config_hash,scenario_hash,request,max_messages,budget_brl,deadline_at)
 values(r,'admin-renato-lagares','manual','running',repeat('a',40),'hash','hash','{}',6,5,now()+interval '20 minutes'),
 (other_run,'admin-renato-lagares','manual','running',repeat('a',40),'hash','hash','{}',6,5,now()+interval '20 minutes');
 insert into public.agent_test_lab_assets(id,owner_admin_id,storage_path,kind,mime_type,byte_size,filename,checksum,upload_status)
 values(a,'admin-renato-lagares','admin-renato-lagares/'||a||'.txt','document','text/plain',5,'fixture.txt','pending','pending');
 begin
  insert into public.agent_test_lab_steps(run_id,ordinal,kind,command,idempotency_key)
   values(r,0,'document',jsonb_build_object('assetId',a),'uploads-v4-pending');
  raise exception 'pending_upload_enqueued';
 exception when others then if sqlerrm<>'asset_unavailable' then raise; end if; end;
 update public.agent_test_lab_assets set upload_status='rejected' where id=a;
 begin
  insert into public.agent_test_lab_steps(run_id,ordinal,kind,command,idempotency_key)
   values(r,0,'document',jsonb_build_object('assetId',a),'uploads-v4-rejected');
  raise exception 'rejected_upload_enqueued';
 exception when others then if sqlerrm<>'asset_unavailable' then raise; end if; end;
 update public.agent_test_lab_assets set upload_status='ready',checksum='verified' where id=a;
 insert into public.agent_test_lab_steps(run_id,ordinal,kind,command,idempotency_key)
  values(r,0,'document',jsonb_build_object('assetId',a),'uploads-v4-ready');
 begin
  update public.agent_test_lab_steps set kind='image' where run_id=r;
  raise exception 'wrong_kind_update';
 exception when others then if sqlerrm<>'asset_unavailable' then raise; end if; end;
 update public.agent_test_lab_assets set run_id=other_run where id=a;
 begin
  insert into public.agent_test_lab_steps(run_id,ordinal,kind,command,idempotency_key)
   values(r,1,'document',jsonb_build_object('assetId',a),'uploads-v4-foreign-run');
  raise exception 'foreign_run_asset';
 exception when others then if sqlerrm<>'asset_unavailable' then raise; end if; end;
end $test$;
rollback;
