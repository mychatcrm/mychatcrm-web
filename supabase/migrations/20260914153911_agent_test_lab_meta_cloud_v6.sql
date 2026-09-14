begin;

-- Meta Cloud support for the private agent-test laboratory. Customer connection
-- tables and production routing are unchanged.
alter table public.agent_test_lab_connections
  add column provider text not null default 'evolution'
    check (provider in ('evolution','meta_cloud')),
  add column phone_number_id text,
  add column waba_id text,
  add column access_token text,
  add column display_phone text,
  add column verified_name text,
  add column webhook_subscribed boolean,
  add column phone_registered boolean;

alter table public.agent_test_lab_connections
  add constraint agent_test_lab_connection_provider_shape check (
    archived_at is not null
    or
    (provider='evolution' and phone_number_id is null and access_token is null)
    or
    (provider='meta_cloud' and phone_number_id is not null and access_token is not null)
  );

create unique index agent_test_lab_meta_phone_active
  on public.agent_test_lab_connections(phone_number_id)
  where provider='meta_cloud' and archived_at is null;

-- Meta's operational connection identity is phone_number_id (text), while an
-- Evolution connection is a UUID serialized as text. Lab-only columns therefore
-- use text so both providers can be represented without guessing or fallback.
alter table public.agent_test_lab_destinations
  alter column connection_id type text using connection_id::text;
alter table public.agent_test_lab_runs
  alter column target_connection_id type text using target_connection_id::text;

drop function if exists public.confirm_agent_test_lab_destination_v1(text,text,uuid,text,text,text);
create function public.confirm_agent_test_lab_destination_v1(
 p_owner text, p_tenant_id text, p_connection_id text, p_channel text, p_target_jid text, p_sender_jid text)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare d public.agent_test_lab_destinations; begin
 if not exists(select 1 from public.admin_users where id=p_owner and id='admin-renato-lagares' and active and role='super_admin') then
   raise exception 'owner_inactive'; end if;
 if p_connection_id is null or length(p_connection_id) not between 1 and 150 then raise exception 'invalid_connection'; end if;
 if p_target_jid is null or p_sender_jid is null or p_target_jid=p_sender_jid then raise exception 'same_number_rejected'; end if;
 if p_channel not in ('evolution','meta_cloud') then raise exception 'invalid_channel'; end if;
 insert into public.agent_test_lab_destinations(owner_admin_id,tenant_id,connection_id,channel,target_jid)
 values(p_owner,p_tenant_id,p_connection_id,p_channel,p_target_jid)
 on conflict(owner_admin_id,tenant_id,connection_id,channel,target_jid)
 do update set confirmed_at=now(), revoked_at=null
 returning * into d;
 return jsonb_build_object('id',d.id,'confirmedAt',d.confirmed_at);
end $fn$;
revoke all on function public.confirm_agent_test_lab_destination_v1(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.confirm_agent_test_lab_destination_v1(text,text,text,text,text,text) to service_role;

create or replace function public.authorize_agent_test_lab_step_dispatch_v3(p_run_id uuid,p_step_id uuid,p_claim uuid)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare r public.agent_test_lab_runs; begin
 select * into r from public.agent_test_lab_runs where id=p_run_id for update;
 if not found or p_claim is null or r.claim_token is distinct from p_claim or r.claim_expires_at is null
   or r.claim_expires_at<=now() or r.deadline_at<=now() or r.status<>'running' then return false; end if;
 if not exists(select 1 from public.admin_users where id=r.owner_admin_id and id='admin-renato-lagares' and active and role='super_admin') then return false; end if;
 if not exists(select 1 from public.agent_test_lab_connections s where s.id=r.sender_connection_id
   and s.owner_admin_id=r.owner_admin_id and s.purpose='sender' and s.state='open' and s.archived_at is null
   and s.wa_jid=r.tester_jid
   and ((s.provider='evolution' and s.instance_name like 'mychatcrm-lab-sender-%')
     or (s.provider='meta_cloud' and s.phone_number_id is not null and s.access_token is not null))) then return false; end if;
 if not exists(select 1 from public.agent_test_lab_destinations where owner_admin_id=r.owner_admin_id
   and tenant_id=r.target_tenant_id and connection_id=r.target_connection_id and channel=r.target_channel
   and target_jid=r.target_jid and revoked_at is null) then return false; end if;
 update public.agent_test_lab_steps set dispatch_authorized_at=now() where id=p_step_id and run_id=p_run_id
   and status='dispatching' and dispatch_started_at is not null and confirmed_at is null and dispatch_authorized_at is null;
 return found;
end $fn$;
revoke all on function public.authorize_agent_test_lab_step_dispatch_v3(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_agent_test_lab_step_dispatch_v3(uuid,uuid,uuid) to service_role;

drop function if exists public.authorize_agent_test_lab_inbound_v3(text,uuid,text,text,timestamptz);
create function public.authorize_agent_test_lab_inbound_v3(
 p_tenant text,p_connection text,p_instance text,p_remote_jid text,p_occurred_at timestamptz)
returns boolean language sql stable security invoker set search_path='' as $fn$
 select exists(
   select 1 from public.agent_test_lab_runs r
   join public.agent_test_lab_isolated_agents a on a.lab_tenant_id=r.target_tenant_id and a.lab_agent_id=r.target_agent_id
     and a.owner_admin_id=r.owner_admin_id and a.archived_at is null
   join public.agent_test_lab_connections receiver on receiver.instance_name=p_instance and receiver.purpose='receiver'
     and receiver.owner_admin_id=r.owner_admin_id and receiver.archived_at is null and receiver.state='open'
   join public.agent_test_lab_connections sender on sender.id=r.sender_connection_id and sender.purpose='sender'
     and sender.owner_admin_id=r.owner_admin_id and sender.archived_at is null and sender.state='open' and sender.wa_jid=r.tester_jid
   join public.admin_users owner on owner.id=r.owner_admin_id and owner.id='admin-renato-lagares' and owner.active and owner.role='super_admin'
   where r.target_tenant_id=p_tenant and r.target_connection_id=p_connection
     and r.request->>'targetKind'='copy' and r.tester_jid=p_remote_jid
     and p_tenant like 'tenant-lab-%' and not exists(select 1 from public.tenants where id=p_tenant)
     and r.status in ('running','waiting_reply','waiting_input','paused') and r.deadline_at>now()
     and p_occurred_at>=date_trunc('second',r.created_at) and p_occurred_at<=now()+interval '5 seconds'
     and p_occurred_at<=r.deadline_at
     and exists(select 1 from public.agent_test_lab_destinations d where d.owner_admin_id=r.owner_admin_id
       and d.tenant_id=p_tenant and d.connection_id=p_connection and d.channel=r.target_channel
       and d.target_jid=r.target_jid and d.revoked_at is null)
     and (
       (r.target_channel='evolution' and receiver.provider='evolution'
         and p_instance like 'mychatcrm-lab-receiver-%'
         and exists(select 1 from public.tenant_evolution_instances c where c.id::text=p_connection
           and c.tenant_id=p_tenant and c.instance_name=p_instance and c.wa_jid=r.target_jid))
       or
       (r.target_channel='meta_cloud' and receiver.provider='meta_cloud'
         and receiver.phone_number_id=p_connection
         and receiver.wa_jid=r.target_jid
         and exists(select 1 from public.whatsapp_cloud_connections c where c.phone_number_id=p_connection
           and c.tenant_id=p_tenant and c.active and c.display_phone is not null))
     )
 );
$fn$;
revoke all on function public.authorize_agent_test_lab_inbound_v3(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.authorize_agent_test_lab_inbound_v3(text,text,text,text,timestamptz) to service_role;

commit;
