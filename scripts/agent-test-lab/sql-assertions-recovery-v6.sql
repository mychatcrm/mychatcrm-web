begin;
do $assertions$
declare v_job_count integer; v_definer boolean; v_anon boolean; v_service boolean;
begin
  select count(*) into v_job_count from cron.job where jobname='mychatcrm-agent-test-lab-minute' and schedule='* * * * *' and active;
  if v_job_count <> 1 then raise exception 'lab recovery cron missing or duplicated'; end if;
  select p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('service_role',p.oid,'EXECUTE')
    into v_definer,v_anon,v_service from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='dispatch_agent_test_lab_recovery_v1';
  if v_definer is distinct from true or v_anon is distinct from false or v_service is distinct from true then
    raise exception 'lab recovery permissions invalid';
  end if;
  if private.dispatch_agent_test_lab_recovery_v1() is not null then raise exception 'empty lab must not dispatch'; end if;
end;
$assertions$;
rollback;
