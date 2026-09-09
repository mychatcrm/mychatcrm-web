-- Preserve the confirmed primary response through subsequent follow-up attempts.
-- No historical jobs are changed or re-enqueued.
create or replace function public.finish_follow_up_job_v2(
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_attempts integer default null,
  p_scheduled_at timestamptz default null,
  p_follow_up_type text default null,
  p_priority integer default null,
  p_last_error text default null,
  p_next_scheduled_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn7$
declare
  v_now timestamptz := clock_timestamp();
  v_job public.follow_up_jobs;
  v_next_id uuid;
begin
  if p_status not in ('pending', 'sent', 'exhausted', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  if p_status = 'sent' and p_next_scheduled_at is null then
    return jsonb_build_object('ok', false, 'reason', 'next_schedule_required');
  end if;

  select *
    into v_job
    from public.follow_up_jobs
   where id = p_job_id
     and status = 'processing'
     and claim_token = p_claim_token
     and claim_expires_at > v_now
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'claim_lost');
  end if;

  if p_status = 'sent' and v_job.response_confirmed_at is null then
    return jsonb_build_object('ok', false, 'reason', 'response_confirmation_required');
  end if;

  if p_status = 'sent' then
    insert into public.follow_up_jobs (
      tenant_id, agent_id, remote_jid, lead_id, journey_id,
      channel, connection_id, rule_id, automation_epoch,
      scheduled_at, attempts, max_attempts, status,
      follow_up_type, priority, context_summary,
      response_confirmed_at, source_response_job_id, source_generation
    ) values (
      v_job.tenant_id, v_job.agent_id, v_job.remote_jid, v_job.lead_id,
      v_job.journey_id, v_job.channel, v_job.connection_id, v_job.rule_id,
      v_job.automation_epoch, p_next_scheduled_at,
      coalesce(p_attempts, v_job.attempts), v_job.max_attempts, 'pending',
      'silence', coalesce(p_priority, v_job.priority), v_job.context_summary,
      v_job.response_confirmed_at, v_job.source_response_job_id, v_job.source_generation
    )
    returning id into v_next_id;
  end if;

  update public.follow_up_jobs
     set status = p_status,
         attempts = coalesce(p_attempts, attempts),
         scheduled_at = coalesce(p_scheduled_at, scheduled_at),
         follow_up_type = coalesce(p_follow_up_type, follow_up_type),
         priority = coalesce(p_priority, priority),
         last_error = p_last_error,
         updated_at = v_now
   where id = p_job_id
     and status = 'processing'
     and claim_token = p_claim_token;

  if not found then
    raise exception 'follow_up_claim_changed_during_finish';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', p_status,
    'nextJobId', v_next_id
  );
end;
$fn7$;

revoke all on function public.finish_follow_up_job_v2(
  uuid, uuid, text, integer, timestamptz, text, integer, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finish_follow_up_job_v2(
  uuid, uuid, text, integer, timestamptz, text, integer, text, timestamptz
) to service_role;


-- Dedicated recovery dispatcher, reusing the existing Vault secret and HMAC contract.
-- Activation is a separate deployment step after the compatible route is READY.
create or replace function private.dispatch_agent_response_recovery_v1()
returns bigint language plpgsql security definer set search_path='' as $recovery$
declare
  v_secret text; v_timestamp text; v_nonce uuid; v_signature text; v_request bigint;
  v_path constant text := '/api/internal/agent-response-jobs/process';
begin
  select btrim(decrypted_secret) into v_secret from vault.decrypted_secrets
    where name='meta_leadgen_scheduler_secret' order by updated_at desc limit 1;
  if v_secret is null or octet_length(v_secret)<32 then
    insert into private.agent_runtime_scheduler_dispatches(queue,status) values('agent_responses','config_missing');
    return null;
  end if;
  v_timestamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce:=gen_random_uuid();
  v_signature:=encode(extensions.hmac(convert_to(concat_ws(chr(10),'POST',v_path,v_timestamp,v_nonce::text),'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  select net.http_post(url:='https://www.mychatcrm.com.br'||v_path,body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','X-MyChatCRM-Timestamp',v_timestamp,'X-MyChatCRM-Nonce',v_nonce::text,'X-MyChatCRM-Signature','sha256='||v_signature),timeout_milliseconds:=10000) into v_request;
  insert into private.agent_runtime_scheduler_dispatches(queue,nonce,request_id,status) values('agent_responses',v_nonce,v_request,'queued');
  return v_request;
exception when others then
  insert into private.agent_runtime_scheduler_dispatches(queue,nonce,status) values('agent_responses',v_nonce,'request_failed');
  return null;
end; $recovery$;
revoke all on function private.dispatch_agent_response_recovery_v1() from public,anon,authenticated;
grant execute on function private.dispatch_agent_response_recovery_v1() to service_role;

-- Trigger-only audit functions must not be exposed as public RPCs.
revoke execute on function public.prevent_operational_audit_mutation_v1() from public, anon, authenticated;
revoke execute on function public.refresh_operational_audit_operation_v1() from public, anon, authenticated;
grant execute on function public.prevent_operational_audit_mutation_v1() to service_role;
grant execute on function public.refresh_operational_audit_operation_v1() to service_role;
