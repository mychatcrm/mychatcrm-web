-- Final safety layer for Meta Lead Ads lifecycle, capture boundaries and inbox recovery.

create schema if not exists private;

create table if not exists private.meta_lead_oauth_cursor (
  tenant_id text primary key,
  active_nonce uuid,
  generation bigint not null default 0 check (generation >= 0),
  started_at timestamptz,
  callback_claimed_at timestamptz,
  completed_at timestamptz,
  disconnected_at timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on table private.meta_lead_oauth_cursor from public, anon, authenticated;
grant select, insert, update, delete on table private.meta_lead_oauth_cursor to service_role;

alter table public.meta_lead_grants
  add column if not exists oauth_nonce uuid;

update public.meta_lead_grants set oauth_nonce=gen_random_uuid() where oauth_nonce is null;
insert into private.meta_lead_oauth_cursor(
  tenant_id,active_nonce,generation,started_at,callback_claimed_at,completed_at,updated_at
)
select tenant_id,oauth_nonce,1,coalesce(created_at,now()),coalesce(updated_at,now()),coalesce(updated_at,now()),now()
from public.meta_lead_grants
where oauth_nonce is not null
on conflict(tenant_id) do nothing;
alter table public.meta_lead_grants alter column oauth_nonce set not null;

create table if not exists public.meta_form_capture_boundaries (
  tenant_id text not null,
  rule_id uuid not null references public.lead_distribution_rules(id) on delete cascade,
  page_id text not null,
  form_id text not null,
  activated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, rule_id, page_id, form_id),
  check (length(btrim(page_id)) between 1 and 128),
  check (length(btrim(form_id)) between 1 and 128)
);

create index if not exists meta_form_capture_boundaries_lookup_idx
  on public.meta_form_capture_boundaries (tenant_id, page_id, form_id, rule_id);
alter table public.meta_form_capture_boundaries enable row level security;
revoke all on table public.meta_form_capture_boundaries from public, anon, authenticated;
grant select, insert, update, delete on table public.meta_form_capture_boundaries to service_role;

insert into public.meta_form_capture_boundaries(
  tenant_id,rule_id,page_id,form_id,activated_at,created_at,updated_at
)
select rule.tenant_id,rule.id,rule.page_id,form_id,
       greatest(
         coalesce(rule.created_at, rule.updated_at, now()),
         coalesce(connection.connected_at, '-infinity'::timestamptz)
       ),now(),now()
from public.lead_distribution_rules as rule
left join public.meta_connections as connection
  on connection.tenant_id=rule.tenant_id and connection.page_id=rule.page_id
cross join lateral (
  select '*'::text as form_id where rule.use_all_forms=true
  union all
  select value from jsonb_array_elements_text(
    coalesce(rule.included_form_ids, '[]'::jsonb)
  ) as value where rule.use_all_forms=false
) as authorized_form
where rule.source='meta_form' and rule.active=true
  and nullif(btrim(rule.page_id),'') is not null and nullif(btrim(form_id),'') is not null
on conflict(tenant_id,rule_id,page_id,form_id) do nothing;

alter table public.meta_leadgen_inbox
  add column if not exists last_failure_retryable boolean,
  add column if not exists manual_review_required boolean not null default false,
  add column if not exists review_status text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

alter table private.meta_maintenance_runs
  add column if not exists inbox_review_required integer not null default 0
  check (inbox_review_required >= 0);

alter table public.meta_leadgen_inbox
  drop constraint if exists meta_leadgen_inbox_status_check;
alter table public.meta_leadgen_inbox
  add constraint meta_leadgen_inbox_status_check
  check (status in ('pending','processing','retrying','completed','dead_letter','review_required'));
alter table public.meta_leadgen_inbox
  drop constraint if exists meta_leadgen_inbox_review_status_check;
alter table public.meta_leadgen_inbox
  add constraint meta_leadgen_inbox_review_status_check
  check (review_status is null or review_status in ('pending','approved','dismissed'));

update public.meta_leadgen_inbox
set manual_review_required = true,
    review_status = 'pending',
    last_failure_retryable = true,
    updated_at = now()
where status = 'dead_letter'
  and last_error_code in ('meta_connection_not_operational','meta_connection_not_operational_yet')
  and review_status is null;

create or replace function public.begin_meta_lead_oauth(
  p_tenant_id text,
  p_nonce uuid
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_generation bigint;
begin
  if nullif(pg_catalog.btrim(p_tenant_id), '') is null or p_nonce is null then
    raise exception 'invalid_meta_oauth_begin';
  end if;
  insert into private.meta_lead_oauth_cursor as cursor_row (
    tenant_id, active_nonce, generation, started_at, callback_claimed_at,
    completed_at, disconnected_at, updated_at
  ) values (
    p_tenant_id, p_nonce, 1, clock_timestamp(), null, null, null, clock_timestamp()
  )
  on conflict (tenant_id) do update set
    active_nonce = excluded.active_nonce,
    generation = cursor_row.generation + 1,
    started_at = excluded.started_at,
    callback_claimed_at = null,
    completed_at = null,
    disconnected_at = null,
    updated_at = excluded.updated_at
  returning generation into v_generation;
  return v_generation;
end;
$$;

create or replace function public.claim_meta_lead_oauth_callback(
  p_tenant_id text,
  p_nonce uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer;
begin
  if nullif(pg_catalog.btrim(p_tenant_id), '') is null or p_nonce is null then
    return false;
  end if;
  update private.meta_lead_oauth_cursor
  set callback_claimed_at = clock_timestamp(), updated_at = clock_timestamp()
  where tenant_id = p_tenant_id
    and active_nonce = p_nonce
    and callback_claimed_at is null
    and disconnected_at is null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.save_meta_lead_oauth_grant(
  p_tenant_id text,
  p_nonce uuid,
  p_user_access_token text,
  p_token_kind text,
  p_token_mode text,
  p_discovery_status text,
  p_last_error_code text,
  p_next_discovery_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_fingerprint text;
begin
  if nullif(pg_catalog.btrim(p_tenant_id), '') is null
     or p_nonce is null
     or nullif(pg_catalog.btrim(p_user_access_token), '') is null
     or p_token_mode not in ('business_integration_system_user','user')
     or p_discovery_status not in ('discovering','retrying') then
    raise exception 'invalid_meta_oauth_grant';
  end if;
  perform 1 from private.meta_lead_oauth_cursor
   where tenant_id = p_tenant_id and active_nonce = p_nonce
     and callback_claimed_at is not null and disconnected_at is null
   for update;
  if not found then return null; end if;
  v_fingerprint := encode(extensions.digest(convert_to(chr(31) || p_user_access_token,'UTF8'),'sha256'),'hex');
  insert into public.meta_lead_grants (
    tenant_id,user_access_token,credential_fingerprint,user_token_fingerprint,
    token_kind,token_mode,oauth_nonce,discovery_status,last_error_code,
    next_discovery_at,updated_at
  ) values (
    p_tenant_id,p_user_access_token,v_fingerprint,
    encode(extensions.digest(convert_to(p_user_access_token,'UTF8'),'sha256'),'hex'),
    p_token_kind,p_token_mode,p_nonce,p_discovery_status,p_last_error_code,
    p_next_discovery_at,clock_timestamp()
  ) on conflict (tenant_id) do update set
    user_access_token=excluded.user_access_token,
    token_kind=excluded.token_kind,
    token_mode=excluded.token_mode,
    oauth_nonce=excluded.oauth_nonce,
    discovery_status=excluded.discovery_status,
    last_error_code=excluded.last_error_code,
    next_discovery_at=excluded.next_discovery_at,
    updated_at=excluded.updated_at;
  return v_fingerprint;
end;
$$;

create or replace function public.complete_meta_lead_oauth(
  p_tenant_id text,
  p_nonce uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer;
begin
  update private.meta_lead_oauth_cursor
  set completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where tenant_id=p_tenant_id and active_nonce=p_nonce and disconnected_at is null;
  get diagnostics v_updated = row_count;
  return v_updated=1;
end;
$$;

create or replace function public.upsert_meta_grant_discovered_pages_v2(
  p_tenant_id text,
  p_expected_grant_fingerprint text,
  p_oauth_nonce uuid,
  p_pages jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(pg_catalog.btrim(p_tenant_id),'') is null
     or p_expected_grant_fingerprint is null
     or p_expected_grant_fingerprint !~ '^[0-9a-f]{64}$'
     or p_oauth_nonce is null
     or pg_catalog.jsonb_typeof(coalesce(p_pages,'[]'::jsonb)) <> 'array' then
    raise exception 'invalid_meta_grant_page_batch';
  end if;
  perform 1 from private.meta_lead_oauth_cursor
   where tenant_id=p_tenant_id and active_nonce=p_oauth_nonce and disconnected_at is null
   for update;
  if not found then return false; end if;
  perform 1 from public.meta_lead_grants
   where tenant_id=p_tenant_id and credential_fingerprint=p_expected_grant_fingerprint
     and oauth_nonce=p_oauth_nonce
   for update;
  if not found then return false; end if;
  return public.upsert_meta_grant_discovered_pages(
    p_tenant_id,p_expected_grant_fingerprint,p_pages
  );
end;
$$;

create or replace function public.disconnect_meta_lead_tenant(p_tenant_id text)
returns table(page_id text, page_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(pg_catalog.btrim(p_tenant_id), '') is null then
    raise exception 'invalid_meta_disconnect';
  end if;
  insert into private.meta_lead_oauth_cursor as cursor_row (
    tenant_id,active_nonce,generation,disconnected_at,updated_at
  ) values (p_tenant_id,null,1,clock_timestamp(),clock_timestamp())
  on conflict (tenant_id) do update set
    active_nonce=null,
    generation=cursor_row.generation+1,
    callback_claimed_at=null,
    completed_at=null,
    disconnected_at=clock_timestamp(),
    updated_at=clock_timestamp();

  delete from public.meta_form_agent_mapping where tenant_id=p_tenant_id;
  delete from public.meta_form_capture_boundaries where tenant_id=p_tenant_id;
  delete from public.meta_lead_grants where tenant_id=p_tenant_id;
  return query
  delete from public.meta_connections as connection
   where connection.tenant_id=p_tenant_id
  returning connection.page_id,connection.page_name;
end;
$$;

create or replace function public.sync_meta_form_capture_boundaries(
  p_tenant_id text,
  p_rule_id uuid,
  p_page_id text,
  p_form_ids text[],
  p_use_all_forms boolean,
  p_active boolean
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_page_id text := nullif(pg_catalog.btrim(p_page_id),'');
begin
  if nullif(pg_catalog.btrim(p_tenant_id),'') is null or p_rule_id is null then
    raise exception 'invalid_meta_capture_boundary';
  end if;
  delete from public.meta_form_capture_boundaries
   where tenant_id=p_tenant_id and rule_id=p_rule_id
     and (
       not coalesce(p_active,false)
       or v_page_id is null
       or page_id<>v_page_id
       or (
         not coalesce(p_use_all_forms,false)
         and not (form_id=any(coalesce(p_form_ids,'{}'::text[])))
       )
       or (coalesce(p_use_all_forms,false) and form_id<>'*')
     );
  if coalesce(p_active,false) and v_page_id is not null then
    insert into public.meta_form_capture_boundaries(tenant_id,rule_id,page_id,form_id)
    select p_tenant_id,p_rule_id,v_page_id,pg_catalog.btrim(form_id)
      from unnest(
        case when coalesce(p_use_all_forms,false)
          then array['*']::text[]
          else coalesce(p_form_ids,'{}'::text[])
        end
      ) as form_id
     where nullif(pg_catalog.btrim(form_id),'') is not null
    on conflict (tenant_id,rule_id,page_id,form_id) do update
      set updated_at=clock_timestamp();
  end if;
  return true;
end;
$$;

create or replace function public.fail_meta_leadgen_event_v2(
  p_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_fingerprint text,
  p_next_attempt_at timestamptz,
  p_retryable boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.meta_leadgen_inbox%rowtype; v_code text;
begin
  if p_id is null or p_claim_token is null or p_retryable is null
     or p_error_fingerprint is null or p_error_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_meta_leadgen_failure';
  end if;
  v_code := left(coalesce(nullif(pg_catalog.btrim(p_error_code),''),'processing_failed'),96);
  select * into v_row from public.meta_leadgen_inbox
   where id=p_id and status='processing' and claim_token=p_claim_token for update;
  if not found then return 'claim_lost'; end if;
  if not p_retryable then
    update public.meta_leadgen_inbox set status='dead_letter',dead_lettered_at=clock_timestamp(),
      claim_token=null,claimed_at=null,last_error_code=v_code,error_fingerprint=p_error_fingerprint,
      last_failure_retryable=false,manual_review_required=true,review_status='pending',updated_at=clock_timestamp()
    where id=v_row.id;
    insert into public.meta_leadgen_inbox_failures(inbox_id,failure_code,error_fingerprint,attempts)
    values(v_row.id,v_code,p_error_fingerprint,v_row.attempts) on conflict(inbox_id) do nothing;
    return 'dead_letter';
  end if;
  if v_row.attempts >= v_row.max_attempts then
    update public.meta_leadgen_inbox set status='review_required',claim_token=null,claimed_at=null,
      last_error_code=v_code,error_fingerprint=p_error_fingerprint,last_failure_retryable=true,
      manual_review_required=true,review_status='pending',updated_at=clock_timestamp()
    where id=v_row.id;
    return 'review_required';
  end if;
  update public.meta_leadgen_inbox set status='retrying',next_attempt_at=greatest(coalesce(p_next_attempt_at,clock_timestamp()),clock_timestamp()),
    claim_token=null,claimed_at=null,last_error_code=v_code,error_fingerprint=p_error_fingerprint,
    last_failure_retryable=true,updated_at=clock_timestamp() where id=v_row.id;
  return 'retrying';
end;
$$;

create or replace function public.finish_meta_maintenance_run_v2(
  p_run_id uuid,
  p_lease_token uuid,
  p_status text,
  p_inbox_claimed integer default 0,
  p_inbox_completed integer default 0,
  p_inbox_retrying integer default 0,
  p_inbox_dead_letter integer default 0,
  p_inbox_review_required integer default 0,
  p_inbox_claim_lost integer default 0,
  p_inbox_errors integer default 0,
  p_health_checked integer default 0,
  p_health_ready integer default 0,
  p_health_degraded integer default 0,
  p_health_action_required integer default 0,
  p_grants_checked integer default 0,
  p_pages_discovered integer default 0,
  p_inbox_error_code text default null,
  p_health_error_code text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer;
begin
  if p_run_id is null or p_lease_token is null
     or p_status not in ('completed','partial','failed') then
    return false;
  end if;
  update private.meta_maintenance_runs set
    status=p_status, completed_at=clock_timestamp(),
    inbox_claimed=greatest(coalesce(p_inbox_claimed,0),0),
    inbox_completed=greatest(coalesce(p_inbox_completed,0),0),
    inbox_retrying=greatest(coalesce(p_inbox_retrying,0),0),
    inbox_dead_letter=greatest(coalesce(p_inbox_dead_letter,0),0),
    inbox_review_required=greatest(coalesce(p_inbox_review_required,0),0),
    inbox_claim_lost=greatest(coalesce(p_inbox_claim_lost,0),0),
    inbox_errors=greatest(coalesce(p_inbox_errors,0),0),
    health_checked=greatest(coalesce(p_health_checked,0),0),
    health_ready=greatest(coalesce(p_health_ready,0),0),
    health_degraded=greatest(coalesce(p_health_degraded,0),0),
    health_action_required=greatest(coalesce(p_health_action_required,0),0),
    grants_checked=greatest(coalesce(p_grants_checked,0),0),
    pages_discovered=greatest(coalesce(p_pages_discovered,0),0),
    inbox_error_code=case when p_inbox_error_code~'^[a-z0-9_]{1,96}$' then p_inbox_error_code end,
    health_error_code=case when p_health_error_code~'^[a-z0-9_]{1,96}$' then p_health_error_code end
  where id=p_run_id and lease_token=p_lease_token and status='running'
    and exists(
      select 1 from private.meta_maintenance_leases
      where lease_key='meta_maintenance' and run_id=p_run_id
        and lease_token=p_lease_token and expires_at>=clock_timestamp()
    );
  get diagnostics v_updated=row_count;
  delete from private.meta_maintenance_leases
   where lease_key='meta_maintenance' and run_id=p_run_id and lease_token=p_lease_token;
  return v_updated=1;
end;
$$;

revoke all on function public.begin_meta_lead_oauth(text,uuid) from public,anon,authenticated;
revoke all on function public.claim_meta_lead_oauth_callback(text,uuid) from public,anon,authenticated;
revoke all on function public.save_meta_lead_oauth_grant(text,uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_meta_lead_oauth(text,uuid) from public,anon,authenticated;
revoke all on function public.upsert_meta_grant_discovered_pages_v2(text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.disconnect_meta_lead_tenant(text) from public,anon,authenticated;
revoke all on function public.sync_meta_form_capture_boundaries(text,uuid,text,text[],boolean,boolean) from public,anon,authenticated;
revoke all on function public.fail_meta_leadgen_event_v2(uuid,uuid,text,text,timestamptz,boolean) from public,anon,authenticated;
revoke all on function public.finish_meta_maintenance_run_v2(uuid,uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.begin_meta_lead_oauth(text,uuid) to service_role;
grant execute on function public.claim_meta_lead_oauth_callback(text,uuid) to service_role;
grant execute on function public.save_meta_lead_oauth_grant(text,uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.complete_meta_lead_oauth(text,uuid) to service_role;
grant execute on function public.upsert_meta_grant_discovered_pages_v2(text,text,uuid,jsonb) to service_role;
grant execute on function public.disconnect_meta_lead_tenant(text) to service_role;
grant execute on function public.sync_meta_form_capture_boundaries(text,uuid,text,text[],boolean,boolean) to service_role;
grant execute on function public.fail_meta_leadgen_event_v2(uuid,uuid,text,text,timestamptz,boolean) to service_role;
grant execute on function public.finish_meta_maintenance_run_v2(uuid,uuid,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,text) to service_role;
