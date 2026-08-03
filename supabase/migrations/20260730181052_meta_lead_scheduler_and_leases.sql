-- Source reconciliation for the scheduler migration already applied in production.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;

create table if not exists private.meta_scheduler_nonces (
  nonce uuid primary key, issued_at timestamptz not null,
  accepted_at timestamptz not null default now(), expires_at timestamptz not null,
  constraint meta_scheduler_nonces_expiry_check check (expires_at > issued_at)
);
create index if not exists meta_scheduler_nonces_expires_idx on private.meta_scheduler_nonces(expires_at);

create table if not exists private.meta_maintenance_leases (
  lease_key text primary key check (lease_key='meta_maintenance'), lease_token uuid not null,
  run_id uuid not null, acquired_at timestamptz not null, expires_at timestamptz not null,
  constraint meta_maintenance_leases_expiry_check check (expires_at > acquired_at)
);
create index if not exists meta_maintenance_leases_expires_idx on private.meta_maintenance_leases(expires_at);

create table if not exists private.meta_maintenance_runs (
  id uuid primary key default gen_random_uuid(), nonce uuid not null, lease_token uuid,
  status text not null check(status in('running','completed','partial','failed','skipped_lease','expired')),
  started_at timestamptz not null default now(), lease_expires_at timestamptz, completed_at timestamptz,
  inbox_claimed integer not null default 0, inbox_completed integer not null default 0,
  inbox_retrying integer not null default 0, inbox_dead_letter integer not null default 0,
  inbox_claim_lost integer not null default 0, inbox_errors integer not null default 0,
  health_checked integer not null default 0, health_ready integer not null default 0,
  health_degraded integer not null default 0, health_action_required integer not null default 0,
  grants_checked integer not null default 0, pages_discovered integer not null default 0,
  inbox_error_code text check(inbox_error_code is null or inbox_error_code ~ '^[a-z0-9_]{1,96}$'),
  health_error_code text check(health_error_code is null or health_error_code ~ '^[a-z0-9_]{1,96}$'),
  constraint meta_maintenance_runs_nonnegative_counts_check check(
    inbox_claimed>=0 and inbox_completed>=0 and inbox_retrying>=0 and inbox_dead_letter>=0 and
    inbox_claim_lost>=0 and inbox_errors>=0 and health_checked>=0 and health_ready>=0 and
    health_degraded>=0 and health_action_required>=0 and grants_checked>=0 and pages_discovered>=0)
);
create index if not exists meta_maintenance_runs_started_idx on private.meta_maintenance_runs(started_at desc);
create index if not exists meta_maintenance_runs_status_idx on private.meta_maintenance_runs(status,started_at desc);

create table if not exists private.meta_scheduler_dispatches (
  id bigint generated always as identity primary key, dispatched_at timestamptz not null default now(),
  nonce uuid, request_id bigint, status text not null check(status in('queued','config_missing','request_failed'))
);
create index if not exists meta_scheduler_dispatches_created_idx on private.meta_scheduler_dispatches(dispatched_at desc);
create index if not exists meta_scheduler_dispatches_nonce_idx on private.meta_scheduler_dispatches(nonce) where nonce is not null;

revoke all on all tables in schema private from public,anon,authenticated;
grant select,insert,update,delete on private.meta_scheduler_nonces,private.meta_maintenance_leases,private.meta_maintenance_runs,private.meta_scheduler_dispatches to service_role;

create or replace function public.claim_meta_maintenance_request(p_nonce uuid,p_issued_at timestamptz,p_clock_skew_seconds integer default 120,p_lease_seconds integer default 55)
returns table(accepted boolean,code text,run_id uuid,lease_token uuid)
language plpgsql security definer set search_path=''
as $$
declare v_now timestamptz:=clock_timestamp(); v_skew integer:=greatest(30,least(coalesce(p_clock_skew_seconds,120),300));
  v_lease integer:=greatest(15,least(coalesce(p_lease_seconds,55),55)); v_run uuid:=gen_random_uuid(); v_token uuid:=gen_random_uuid(); v_inserted integer; v_acquired uuid;
begin
  if p_nonce is null or p_issued_at is null then return query select false,'request_invalid',null::uuid,null::uuid; return; end if;
  if abs(extract(epoch from(v_now-p_issued_at)))>v_skew then return query select false,'timestamp_invalid',null::uuid,null::uuid; return; end if;
  delete from private.meta_scheduler_nonces where nonce in(select nonce from private.meta_scheduler_nonces where expires_at<v_now order by expires_at limit 500);
  update private.meta_maintenance_runs set status='expired',completed_at=coalesce(completed_at,v_now),inbox_error_code=coalesce(inbox_error_code,'maintenance_lease_expired') where status='running' and lease_expires_at<v_now;
  insert into private.meta_scheduler_nonces(nonce,issued_at,expires_at) values(p_nonce,p_issued_at,p_issued_at+make_interval(secs=>v_skew+60)) on conflict do nothing;
  get diagnostics v_inserted=row_count; if v_inserted<>1 then return query select false,'nonce_replayed',null::uuid,null::uuid; return; end if;
  insert into private.meta_maintenance_leases as l(lease_key,lease_token,run_id,acquired_at,expires_at)
  values('meta_maintenance',v_token,v_run,v_now,v_now+make_interval(secs=>v_lease))
  on conflict(lease_key) do update set lease_token=excluded.lease_token,run_id=excluded.run_id,acquired_at=excluded.acquired_at,expires_at=excluded.expires_at where l.expires_at<=v_now
  returning lease_token into v_acquired;
  if v_acquired is null or v_acquired<>v_token then insert into private.meta_maintenance_runs(id,nonce,status,started_at,completed_at) values(v_run,p_nonce,'skipped_lease',v_now,v_now); return query select false,'lease_busy',v_run,null::uuid; return; end if;
  insert into private.meta_maintenance_runs(id,nonce,lease_token,status,started_at,lease_expires_at) values(v_run,p_nonce,v_token,'running',v_now,v_now+make_interval(secs=>v_lease));
  return query select true,'accepted',v_run,v_token;
end $$;

create or replace function public.finish_meta_maintenance_run(p_run_id uuid,p_lease_token uuid,p_status text,p_inbox_claimed integer default 0,p_inbox_completed integer default 0,p_inbox_retrying integer default 0,p_inbox_dead_letter integer default 0,p_inbox_claim_lost integer default 0,p_inbox_errors integer default 0,p_health_checked integer default 0,p_health_ready integer default 0,p_health_degraded integer default 0,p_health_action_required integer default 0,p_grants_checked integer default 0,p_pages_discovered integer default 0,p_inbox_error_code text default null,p_health_error_code text default null)
returns boolean language plpgsql security definer set search_path=''
as $$ declare v_updated integer; begin
  if p_run_id is null or p_lease_token is null or p_status not in('completed','partial','failed') then return false; end if;
  update private.meta_maintenance_runs set status=p_status,completed_at=clock_timestamp(),inbox_claimed=greatest(coalesce(p_inbox_claimed,0),0),inbox_completed=greatest(coalesce(p_inbox_completed,0),0),inbox_retrying=greatest(coalesce(p_inbox_retrying,0),0),inbox_dead_letter=greatest(coalesce(p_inbox_dead_letter,0),0),inbox_claim_lost=greatest(coalesce(p_inbox_claim_lost,0),0),inbox_errors=greatest(coalesce(p_inbox_errors,0),0),health_checked=greatest(coalesce(p_health_checked,0),0),health_ready=greatest(coalesce(p_health_ready,0),0),health_degraded=greatest(coalesce(p_health_degraded,0),0),health_action_required=greatest(coalesce(p_health_action_required,0),0),grants_checked=greatest(coalesce(p_grants_checked,0),0),pages_discovered=greatest(coalesce(p_pages_discovered,0),0),inbox_error_code=case when p_inbox_error_code~'^[a-z0-9_]{1,96}$' then p_inbox_error_code end,health_error_code=case when p_health_error_code~'^[a-z0-9_]{1,96}$' then p_health_error_code end
  where id=p_run_id and lease_token=p_lease_token and status='running' and exists(select 1 from private.meta_maintenance_leases where lease_key='meta_maintenance' and run_id=p_run_id and lease_token=p_lease_token and expires_at>=clock_timestamp());
  get diagnostics v_updated=row_count; delete from private.meta_maintenance_leases where lease_key='meta_maintenance' and run_id=p_run_id and lease_token=p_lease_token; return v_updated=1;
end $$;

create or replace function private.dispatch_meta_maintenance() returns bigint language plpgsql security definer set search_path=''
as $$ declare v_secret text; v_timestamp text; v_nonce uuid; v_path constant text:='/api/internal/meta-maintenance'; v_signature text; v_request bigint;
begin
 select btrim(decrypted_secret) into v_secret from vault.decrypted_secrets where name='meta_leadgen_scheduler_secret' order by updated_at desc limit 1;
 if v_secret is null or octet_length(v_secret)<32 then insert into private.meta_scheduler_dispatches(status) values('config_missing'); return null; end if;
 v_timestamp:=floor(extract(epoch from clock_timestamp()))::bigint::text; v_nonce:=gen_random_uuid();
 v_signature:=encode(extensions.hmac(convert_to(concat_ws(E'\n','POST',v_path,v_timestamp,v_nonce::text),'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
 select net.http_post(url:='https://www.mychatcrm.com.br'||v_path,body:='{}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','X-MyChatCRM-Timestamp',v_timestamp,'X-MyChatCRM-Nonce',v_nonce::text,'X-MyChatCRM-Signature','sha256='||v_signature),timeout_milliseconds:=10000) into v_request;
 insert into private.meta_scheduler_dispatches(nonce,request_id,status) values(v_nonce,v_request,'queued'); return v_request;
exception when others then insert into private.meta_scheduler_dispatches(nonce,status) values(v_nonce,'request_failed'); return null; end $$;

revoke all on function public.claim_meta_maintenance_request(uuid,timestamptz,integer,integer) from public,anon,authenticated;
revoke all on function public.finish_meta_maintenance_run(uuid,uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,text) from public,anon,authenticated;
revoke all on function private.dispatch_meta_maintenance() from public,anon,authenticated;
grant execute on function public.claim_meta_maintenance_request(uuid,timestamptz,integer,integer) to service_role;
grant execute on function public.finish_meta_maintenance_run(uuid,uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname='mychatcrm-meta-maintenance-minute';
select cron.schedule('mychatcrm-meta-maintenance-minute','* * * * *',$$select private.dispatch_meta_maintenance();$$);
