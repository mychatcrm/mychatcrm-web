-- Laboratory-only safety corrections. No historical customer run is replayed.
alter table public.agent_test_lab_runs add column tester_jid text;
alter table public.agent_test_lab_runs add column bound_journey_id uuid;

-- Bind only a fresh, exact journey, never one inferred from a phone alone.
create function public.bind_agent_test_lab_journey_v2(p_run_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; j public.lead_journeys; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id for update;
 if not found or r.owner_admin_id<>'admin-renato-lagares' or r.tester_jid is null then raise exception 'lab_scope_missing'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agent-conversation:'||r.target_tenant_id||':'||r.tester_jid,0));
 select j0.* into j from public.lead_journeys j0 join public.conversation_states c
   on c.active_journey_id=j0.id and c.tenant_id=j0.tenant_id and c.remote_jid=j0.remote_jid
 where c.tenant_id=r.target_tenant_id and c.remote_jid=r.tester_jid and c.channel='whatsapp';
 if not found then
   if r.bound_journey_id is not null then raise exception 'lab_journey_mismatch'; end if;
   return null;
 end if;
 if r.bound_journey_id is not null and r.bound_journey_id is distinct from j.id then raise exception 'lab_journey_mismatch'; end if;
 if j.created_at<r.created_at or j.agent_id is distinct from r.target_agent_id
   or j.rule_id is distinct from r.target_rule_id or j.connection_id is distinct from r.target_connection_id::text
   or not exists(select 1 from public.lead_distribution_rules d where d.id=j.rule_id and d.tenant_id=r.target_tenant_id
     and d.transport=case r.target_channel when 'evolution' then 'evolution' when 'meta_cloud' then 'cloud_api' end)
   then raise exception 'lab_journey_mismatch'; end if;
 update public.agent_test_lab_runs set bound_journey_id=j.id where id=r.id;
 return j.id;
end $fn$;

-- Stop uses the normal takeover transaction, only after proving the lab owns the
-- active journey. Confirmed appointments and their synchronization are untouched.
create function public.stop_agent_test_lab_automation_v2(p_run_id uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; c public.conversation_states; journey uuid; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id for update;
 if not found or r.owner_admin_id<>'admin-renato-lagares' then raise exception 'lab_scope_missing'; end if;
 if p_claim is null or r.claim_token is distinct from p_claim or r.claim_expires_at is null or r.claim_expires_at<=now()
   or r.status in ('paused','completed','failed','cancelled') then raise exception 'lab_stop_claim_stale'; end if;
 if r.target_tenant_id is not null and (
   r.request->>'targetKind' is distinct from 'copy' or r.target_tenant_id not like 'tenant-lab-%'
   or not exists(select 1 from public.agent_test_lab_isolated_agents a
     where a.id=r.isolated_agent_id and a.owner_admin_id=r.owner_admin_id
       and a.lab_tenant_id=r.target_tenant_id and a.lab_agent_id=r.target_agent_id and a.archived_at is null)
   or exists(select 1 from public.tenants t where t.id=r.target_tenant_id)
 ) then raise exception 'lab_stop_isolated_only'; end if;
 if r.tester_jid is null or r.target_tenant_id is null then
   if exists(select 1 from public.agent_test_lab_steps where run_id=r.id and dispatch_started_at is not null and kind<>'workflow') then
     raise exception 'lab_stop_scope_missing';
   end if;
   return true;
 end if;
 journey:=public.bind_agent_test_lab_journey_v2(r.id);
 select * into c from public.conversation_states where tenant_id=r.target_tenant_id and remote_jid=r.tester_jid and channel='whatsapp' for update;
 if not found then return true; end if;
 if journey is null or c.active_journey_id is distinct from journey then raise exception 'lab_stop_journey_mismatch'; end if;
 perform public.set_conversation_operation_v3(
   p_tenant_id=>r.target_tenant_id,p_remote_jid=>r.tester_jid,p_lead_id=>c.lead_id,p_agent_id=>r.target_agent_id,
   p_mode=>'human',p_human_paused=>true,p_paused_reason=>'agent_test_lab_stopped',p_paused_by=>r.owner_admin_id,
   p_handoff_suggested=>false,p_handoff_reason=>null,p_assigned_human_id=>null,p_assigned_human_name=>null,
   p_transferred_from=>null,p_transferred_to=>null,p_transfer_reason=>null,p_expected_epoch=>c.automation_epoch,
   p_event_type=>'agent_test_lab_stopped',p_event_title=>'Teste encerrado',p_event_detail=>null,
   p_actor_type=>'admin',p_actor_id=>r.owner_admin_id,p_actor_name=>null);
 return true;
end $fn$;

create or replace function public.control_agent_test_lab_run_v1(p_run_id uuid,p_owner text,p_action text)
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
 update public.agent_test_lab_runs set status=s,
   mode=case when p_action='manual' then 'manual' else mode end,
   claim_token=null,claim_expires_at=null,next_step_at=now(),updated_at=now() where id=r.id;
 return jsonb_build_object('status',s);
end $fn$;

create or replace function public.purge_agent_test_lab_content_v1()
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare messages integer; runs integer; expired uuid[]; begin
 with removed as (
   delete from public.agent_test_lab_messages m using public.agent_test_lab_runs r
   where m.run_id=r.id and r.created_at<now()-interval '30 days' returning m.id
 ) select count(*) into messages from removed;
 -- Storage objects must be deleted by the Storage API BEFORE removing their rows.
 -- Pending/failed object deletion keeps both its row and parent run recoverable.
 update public.agent_test_lab_steps s set command='{}'::jsonb
 from public.agent_test_lab_runs r where s.run_id=r.id and r.created_at<now()-interval '30 days'
   and r.status in ('completed','failed','cancelled');
 update public.agent_test_lab_runs set request='{}'::jsonb where created_at<now()-interval '30 days'
   and status in ('completed','failed','cancelled');
 select array_agg(r.id) into expired from public.agent_test_lab_runs r
 where r.created_at<now()-interval '90 days' and r.status in ('completed','failed','cancelled')
   and not exists(select 1 from public.agent_test_lab_assets a where a.run_id=r.id);
 if expired is null then return jsonb_build_object('messages',messages,'runs',0); end if;
 delete from public.agent_test_lab_messages where run_id=any(expired);
 delete from public.agent_test_lab_effects where run_id=any(expired);
 delete from public.agent_test_lab_evidence where run_id=any(expired);
 delete from public.agent_test_lab_resources where run_id=any(expired);
 delete from public.agent_test_lab_costs where run_id=any(expired);
 delete from public.agent_test_lab_steps where run_id=any(expired);
 with removed as (delete from public.agent_test_lab_runs where id=any(expired) returning id)
 select count(*) into runs from removed;
 return jsonb_build_object('messages',messages,'runs',runs);
end $fn$;
revoke all on function public.bind_agent_test_lab_journey_v2(uuid) from public,anon,authenticated;
revoke all on function public.stop_agent_test_lab_automation_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.bind_agent_test_lab_journey_v2(uuid) to service_role;
grant execute on function public.stop_agent_test_lab_automation_v2(uuid,uuid) to service_role;
