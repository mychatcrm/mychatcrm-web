-- LOCAL DISPOSABLE DATABASE ONLY. Never run against Supabase.
-- Exercises the execution layer: destination confirmation, step admission,
-- stop-all and the retention purge. Each block raises on the first wrong answer.
\set ON_ERROR_STOP on

do $seed$
declare conn uuid; begin
 insert into public.agent_test_lab_connections(id,owner_admin_id,purpose,instance_name,state,wa_jid,webhook_secret_hash)
 values('11111111-1111-4111-8111-111111111111','admin-renato-lagares','sender','mychatcrm-lab-sender-x','open','5511999999999@s.whatsapp.net',repeat('a',64));
 select '22222222-2222-4222-8222-222222222222'::uuid into conn;
 insert into public.agent_test_lab_runs(id,owner_admin_id,mode,status,sender_connection_id,
   target_tenant_id,target_agent_id,target_connection_id,target_channel,target_jid,
   deployed_sha,config_hash,scenario_hash,request,max_messages,budget_brl,deadline_at)
 values('33333333-3333-4333-8333-333333333333','admin-renato-lagares','manual','running',
   '11111111-1111-4111-8111-111111111111','tenant-x','agent-x',conn,'evolution','5511888888888@s.whatsapp.net',
   repeat('f',40),'c','s','{}'::jsonb,2,10,now()+interval '1 hour');
end $seed$;

-- 1. A destination must be confirmed before any step is admitted.
do $t1$
declare r jsonb; begin
 r := public.enqueue_agent_test_lab_step_v1('33333333-3333-4333-8333-333333333333','admin-renato-lagares','text','{}'::jsonb,'k1',0.5);
 if r->>'code' <> 'destination_not_authorized' then raise exception 'esperava destination_not_authorized, veio %', r; end if;
end $t1$;

-- 2. Tester and answering number must differ.
do $t2$
begin
 begin
   perform public.confirm_agent_test_lab_destination_v1('admin-renato-lagares','tenant-x',
     '22222222-2222-4222-8222-222222222222','evolution','5511999999999@s.whatsapp.net','5511999999999@s.whatsapp.net');
   raise exception 'numero igual deveria ter sido recusado';
 exception when others then
   if sqlerrm <> 'same_number_rejected' then raise; end if;
 end;
 perform public.confirm_agent_test_lab_destination_v1('admin-renato-lagares','tenant-x',
   '22222222-2222-4222-8222-222222222222','evolution','5511888888888@s.whatsapp.net','5511999999999@s.whatsapp.net');
end $t2$;

-- 3. Admission reserves budget and a message slot, and numbers the step.
do $t3$
declare r jsonb; run public.agent_test_lab_runs; begin
 r := public.enqueue_agent_test_lab_step_v1('33333333-3333-4333-8333-333333333333','admin-renato-lagares','text','{}'::jsonb,'k1',0.5);
 if r->>'ok' <> 'true' or (r->>'ordinal')::int <> 0 then raise exception 'primeira etapa falhou: %', r; end if;
 select * into run from public.agent_test_lab_runs where id='33333333-3333-4333-8333-333333333333';
 if run.sent_messages <> 1 or run.reserved_brl <> 0.5 then raise exception 'reserva incorreta: % / %', run.sent_messages, run.reserved_brl; end if;
end $t3$;

-- 4. The same key is a retry, not a second message.
do $t4$
declare r jsonb; begin
 r := public.enqueue_agent_test_lab_step_v1('33333333-3333-4333-8333-333333333333','admin-renato-lagares','text','{}'::jsonb,'k1',0.5);
 if r->>'code' <> 'step_already_queued' then raise exception 'esperava step_already_queued, veio %', r; end if;
 if (select sent_messages from public.agent_test_lab_runs where id='33333333-3333-4333-8333-333333333333') <> 1 then
   raise exception 'retry contou mensagem'; end if;
end $t4$;

-- 5. An unconfirmed dispatch stops admission instead of sending again.
do $t5$
declare r jsonb; begin
 update public.agent_test_lab_steps set dispatch_started_at=now() where idempotency_key='k1';
 r := public.enqueue_agent_test_lab_step_v1('33333333-3333-4333-8333-333333333333','admin-renato-lagares','text','{}'::jsonb,'k2',0.5);
 if r->>'code' <> 'provider_receipt_unknown' then raise exception 'esperava provider_receipt_unknown, veio %', r; end if;
 update public.agent_test_lab_steps set confirmed_at=now() where idempotency_key='k1';
end $t5$;

-- 6. The message limit is enforced, not merely displayed.
do $t6$
declare r jsonb; begin
 r := public.enqueue_agent_test_lab_step_v1('33333333-3333-4333-8333-333333333333','admin-renato-lagares','text','{}'::jsonb,'k3',0.5);
 if r->>'ok' <> 'true' then raise exception 'segunda etapa deveria passar: %', r; end if;
 r := public.enqueue_agent_test_lab_step_v1('33333333-3333-4333-8333-333333333333','admin-renato-lagares','text','{}'::jsonb,'k4',0.5);
 if r->>'code' <> 'message_limit' then raise exception 'esperava message_limit, veio %', r; end if;
end $t6$;

-- 7. Budget is checked before the call, not after.
do $t7$
declare r jsonb; begin
 update public.agent_test_lab_runs set max_messages=10, budget_brl=1, reserved_brl=0.9, spent_brl=0
   where id='33333333-3333-4333-8333-333333333333';
 r := public.enqueue_agent_test_lab_step_v1('33333333-3333-4333-8333-333333333333','admin-renato-lagares','text','{}'::jsonb,'k5',0.5);
 if r->>'code' <> 'budget_exhausted' then raise exception 'esperava budget_exhausted, veio %', r; end if;
end $t7$;

-- 8. A revoked destination blocks the next step even mid-run.
do $t8$
declare r jsonb; begin
 update public.agent_test_lab_runs set budget_brl=100, reserved_brl=0 where id='33333333-3333-4333-8333-333333333333';
 update public.agent_test_lab_destinations set revoked_at=now() where tenant_id='tenant-x';
 r := public.enqueue_agent_test_lab_step_v1('33333333-3333-4333-8333-333333333333','admin-renato-lagares','text','{}'::jsonb,'k6',0.5);
 if r->>'code' <> 'destination_not_authorized' then raise exception 'revogacao ignorada: %', r; end if;
 update public.agent_test_lab_destinations set revoked_at=null where tenant_id='tenant-x';
end $t8$;

-- 9. Stop-all reaches every open run and leaves finished ones alone.
do $t9$
declare n integer; begin
 insert into public.agent_test_lab_runs(id,owner_admin_id,mode,status,deployed_sha,config_hash,scenario_hash,request,max_messages,budget_brl,deadline_at)
 values('44444444-4444-4444-8444-444444444444','admin-renato-lagares','internal','completed',repeat('f',40),'c','s','{}'::jsonb,1,1,now()+interval '1 hour');
 n := public.stop_all_agent_test_lab_runs_v1('admin-renato-lagares');
 if n <> 1 then raise exception 'stop-all parou % execucoes, esperava 1', n; end if;
 if (select status from public.agent_test_lab_runs where id='44444444-4444-4444-8444-444444444444') <> 'completed' then
   raise exception 'stop-all mexeu numa execucao ja encerrada'; end if;
end $t9$;

-- 10. Retention deletes children before the run, so the purge cannot fail on a foreign key.
do $t10$
declare r jsonb; begin
 insert into public.agent_test_lab_evidence(run_id,check_code,verdict,description)
   values('33333333-3333-4333-8333-333333333333','c','passed','d');
 insert into public.agent_test_lab_effects(run_id,effect_type,resource_table,resource_id)
   values('33333333-3333-4333-8333-333333333333','agenda','appointments','a1');
 insert into public.agent_test_lab_resources(run_id,tenant_id,resource_type,resource_id)
   values('33333333-3333-4333-8333-333333333333','tenant-x','lead','l1');
 insert into public.agent_test_lab_messages(run_id,direction,kind,content,provider_message_id)
   values('33333333-3333-4333-8333-333333333333','agent','text','oi','p1');
 insert into public.agent_test_lab_assets(owner_admin_id,run_id,storage_path,kind,mime_type,byte_size,filename,checksum)
   values('admin-renato-lagares','33333333-3333-4333-8333-333333333333','p/1','document','application/pdf',10,'a.pdf','x');
 update public.agent_test_lab_runs set created_at=now()-interval '200 days', status='completed'
   where id='33333333-3333-4333-8333-333333333333';
 r := public.purge_agent_test_lab_content_v1();
 if (r->>'runs')::int <> 1 then raise exception 'purge nao removeu a execucao expirada: %', r; end if;
 if exists(select 1 from public.agent_test_lab_steps where run_id='33333333-3333-4333-8333-333333333333') then
   raise exception 'etapas sobreviveram ao purge'; end if;
end $t10$;

-- 11. A purge with nothing expired is a no-op that still reports honestly.
do $t11$
declare r jsonb; begin
 r := public.purge_agent_test_lab_content_v1();
 if (r->>'runs')::int <> 0 then raise exception 'purge removeu algo que nao expirou: %', r; end if;
end $t11$;

select 'execution assertions: todas passaram' as resultado;
