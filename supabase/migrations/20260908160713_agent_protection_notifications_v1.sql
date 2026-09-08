-- Applied migration version reconciled with the Supabase history.
-- Passive consumer of the existing immutable audit. No triggers, new cron,
-- customer mutations, historical replay or external requests in this migration.
create table private.agent_protection_notification_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  activated_at timestamptz
);
insert into private.agent_protection_notification_control(singleton) values(true);
create table private.agent_protection_notifications (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null unique,
  source_key text not null unique,
  trace_id uuid not null,
  tenant_id text,
  agent_id text,
  resource_type text,
  resource_id text,
  reason_code text not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  last_code text,
  sent_at timestamptz
);
create index agent_protection_pending_idx on private.agent_protection_notifications(next_attempt_at)
  where status in ('pending','processing');
alter table private.agent_protection_notifications enable row level security;
alter table private.agent_protection_notification_control enable row level security;
revoke all on private.agent_protection_notifications,private.agent_protection_notification_control from public,anon,authenticated;
grant select,insert,update on private.agent_protection_notifications,private.agent_protection_notification_control to service_role;

create function public.claim_agent_protection_notifications_v1(p_limit integer default 4)
returns setof private.agent_protection_notifications
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.agent_protection_notification_control where enabled) then return; end if;
  -- Never retry an uncertain send beyond the provider's 24-hour idempotency window.
  with exhausted as (
    update private.agent_protection_notifications set status='failed',last_code='notification_retry_exhausted',claim_token=null,claim_expires_at=null
    where status in ('pending','processing') and (claim_expires_at is null or claim_expires_at<now())
      and (attempts>=8 or first_attempt_at<now()-interval '23 hours') returning *
  )
  insert into public.operational_audit_events(operation_id,trace_id,tenant_id,actor_type,module,action,resource_type,resource_id,status,severity,is_critical,result_code,metadata)
  select id,trace_id,tenant_id,'worker','agent.protection.delivery','notification.exhausted','agent_protection_notifications',id::text,
    'error','error',true,'notification_retry_exhausted',jsonb_build_object('attempt',attempts) from exhausted;
  -- Each distinct guard decision has one delivery obligation, even if polling
  -- or a worker restarts. Existing audit remains the source of truth.
  insert into private.agent_protection_notifications(source_event_id,source_key,trace_id,tenant_id,agent_id,resource_type,resource_id,reason_code)
  select e.id,coalesce(e.idempotency_key,e.operation_id::text||':'||e.status||':'||coalesce(e.result_code,'unknown')),
    e.trace_id,e.tenant_id,coalesce(e.related_ids->>'agent_id',e.actor_id),e.resource_type,e.resource_id,
    case when e.result_code ~ '^[a-zA-Z0-9_:.-]{1,160}$' then e.result_code else 'agent_protection_unknown' end
  from public.operational_audit_events e
  where e.occurred_at >= (select activated_at from private.agent_protection_notification_control where singleton)
    and ((e.module='agent.protection' and e.status='blocked')
      or (e.resource_type in ('agent_response_jobs','agent_outbound_outbox','follow_up_jobs',
        'agenda_reminder_jobs_v2','agent_agenda_pending_actions','whatsapp_campaign_recipients')
        and e.status in ('blocked','cancelled','error')
        and (e.metadata->>'previousStatus') is distinct from (e.metadata->>'currentStatus')
        and not exists(select 1 from public.operational_audit_events precise
          where precise.module='agent.protection' and precise.resource_type=e.resource_type
            and precise.resource_id=e.resource_id and precise.occurred_at between e.occurred_at-interval '5 minutes' and e.occurred_at+interval '1 minute')))
    and not exists(select 1 from private.agent_protection_notifications q
      where q.source_key=coalesce(e.idempotency_key,e.operation_id::text||':'||e.status||':'||coalesce(e.result_code,'unknown')))
  order by e.occurred_at limit 200 on conflict do nothing;
  return query
    with picked as (
      select id from private.agent_protection_notifications
      where (status='pending' and next_attempt_at<=now()) or (status='processing' and claim_expires_at<now())
      order by next_attempt_at for update skip locked limit least(greatest(p_limit,1),4)
    )
    update private.agent_protection_notifications q set status='processing',attempts=attempts+1,
      first_attempt_at=coalesce(first_attempt_at,now()),
      claim_token=gen_random_uuid(),claim_expires_at=now()+interval '90 seconds'
    from picked where q.id=picked.id returning q.*;
end; $$;

create function public.finish_agent_protection_notification_v1(p_id uuid,p_claim uuid,p_ok boolean,p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare q private.agent_protection_notifications%rowtype;
begin
  update private.agent_protection_notifications set
    status=case when p_ok then 'sent' when attempts>=8 then 'failed' else 'pending' end,
    sent_at=case when p_ok then now() else null end,
    last_code=case when p_code ~ '^[a-zA-Z0-9_:.-]{1,120}$' then p_code else 'notification_failed' end,
    next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))),
    claim_token=null,claim_expires_at=null
  where id=p_id and claim_token=p_claim and status='processing' and claim_expires_at>now()
  returning * into q;
  if not found then return false; end if;
  insert into public.operational_audit_events(operation_id,trace_id,tenant_id,actor_type,module,action,resource_type,
    resource_id,status,severity,is_critical,result_code,related_ids,metadata)
  values(q.id,q.trace_id,q.tenant_id,'worker','agent.protection.delivery','notification.attempt',
    'agent_protection_notifications',q.id::text,
    case when p_ok then 'completed' when q.status='failed' then 'error' else 'pending' end,
    case when p_ok then 'info' else 'error' end,q.status='failed',q.last_code,
    jsonb_build_object('agent_id',q.agent_id),jsonb_build_object('deliveryCode',q.last_code,'attempt',q.attempts,'deliveryChannel','email'));
  return true;
end; $$;
revoke all on function public.claim_agent_protection_notifications_v1(integer) from public,anon,authenticated;
revoke all on function public.finish_agent_protection_notification_v1(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_agent_protection_notifications_v1(integer),public.finish_agent_protection_notification_v1(uuid,uuid,boolean,text) to service_role;
