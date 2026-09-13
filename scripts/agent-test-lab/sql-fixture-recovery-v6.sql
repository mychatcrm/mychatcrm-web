-- Local disposable fixture only. Never execute in Supabase.
create schema if not exists cron;
create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create or replace function cron.unschedule(p_jobid bigint) returns boolean language plpgsql as $$
begin delete from cron.job where jobid=p_jobid; return found; end;
$$;
create or replace function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language plpgsql as $$
declare v_id bigint; begin
  insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command)
  on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true
  returning jobid into v_id; return v_id;
end;
$$;
