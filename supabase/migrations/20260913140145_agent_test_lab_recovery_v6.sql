-- Recover due laboratory runs without relying on the browser or on Vercel Hobby
-- cron frequency. The endpoint acknowledges the signed request before doing work.
create or replace function private.dispatch_agent_test_lab_recovery_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
  v_timestamp text;
  v_nonce uuid;
  v_signature text;
  v_request bigint;
  v_due boolean;
  v_path constant text := '/api/internal/agent-tests/process';
begin
  select exists (
    select 1
    from public.agent_test_lab_runs r
    where r.owner_admin_id = 'admin-renato-lagares'
      and r.status in ('queued','running','waiting_reply','stopping')
      and r.next_step_at <= now()
      and (r.claim_token is null or r.claim_expires_at is null or r.claim_expires_at <= now())
  ) into v_due;
  if not v_due then return null; end if;

  select btrim(decrypted_secret) into v_secret
  from vault.decrypted_secrets
  where name = 'meta_leadgen_scheduler_secret'
  order by updated_at desc limit 1;
  if v_secret is null or octet_length(v_secret) < 32 then
    insert into private.agent_runtime_scheduler_dispatches(queue,status)
    values ('agent_test_lab','config_missing');
    return null;
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce := gen_random_uuid();
  v_signature := encode(extensions.hmac(
    convert_to(concat_ws(chr(10),'POST',v_path,v_timestamp,v_nonce::text),'UTF8'),
    convert_to(v_secret,'UTF8'),'sha256'),'hex');
  select net.http_post(
    url := 'https://www.mychatcrm.com.br' || v_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-MyChatCRM-Timestamp',v_timestamp,
      'X-MyChatCRM-Nonce',v_nonce::text,
      'X-MyChatCRM-Signature','sha256=' || v_signature),
    timeout_milliseconds := 10000
  ) into v_request;
  insert into private.agent_runtime_scheduler_dispatches(queue,nonce,request_id,status)
  values ('agent_test_lab',v_nonce,v_request,'queued');
  return v_request;
exception when others then
  insert into private.agent_runtime_scheduler_dispatches(queue,nonce,status)
  values ('agent_test_lab',v_nonce,'request_failed');
  return null;
end;
$function$;

revoke all on function private.dispatch_agent_test_lab_recovery_v1() from public, anon, authenticated;
grant execute on function private.dispatch_agent_test_lab_recovery_v1() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'mychatcrm-agent-test-lab-minute';
select cron.schedule(
  'mychatcrm-agent-test-lab-minute',
  '* * * * *',
  $$select private.dispatch_agent_test_lab_recovery_v1();$$
);
