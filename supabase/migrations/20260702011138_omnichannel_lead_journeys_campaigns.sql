-- Omnichannel journey isolation and durable WhatsApp campaigns.
-- Additive only: existing leads, messages, jobs and conversation state remain valid.

alter table public.lead_distribution_rules
  add column if not exists conflict_policy text not null default 'latest_wins',
  add column if not exists conflict_inactivity_minutes integer not null default 1440,
  add column if not exists transport text null,
  add column if not exists connection_id text null;

update public.lead_distribution_rules
   set transport = case source
     when 'whatsapp_api' then 'cloud_api'
     when 'whatsapp_qr' then 'evolution'
     else transport
   end,
       source = case
         when source in ('whatsapp_api', 'whatsapp_qr') then 'whatsapp_organico'
         else source
       end
 where source in ('whatsapp_api', 'whatsapp_qr');

alter table public.lead_distribution_rules
  drop constraint if exists lead_distribution_rules_conflict_policy_check;

alter table public.lead_distribution_rules
  add constraint lead_distribution_rules_conflict_policy_check
  check (conflict_policy in ('latest_wins', 'priority_wins', 'keep_until_inactive', 'manual_review'));

alter table public.lead_distribution_rules
  drop constraint if exists lead_distribution_rules_conflict_inactivity_check;

alter table public.lead_distribution_rules
  add constraint lead_distribution_rules_conflict_inactivity_check
  check (conflict_inactivity_minutes between 1 and 525600);

alter table public.leads
  add column if not exists whatsapp_opt_in boolean not null default false,
  add column if not exists whatsapp_opt_in_at timestamptz null,
  add column if not exists whatsapp_opt_in_source text null,
  add column if not exists whatsapp_opt_out_at timestamptz null;

create table if not exists public.whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  connection_id text not null,
  transport text not null default 'evolution',
  agent_id text null,
  audience_type text not null,
  audience_config jsonb not null default '{}'::jsonb,
  message_template text not null,
  status text not null default 'draft',
  scheduled_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  total_recipients integer not null default 0,
  total_sent integer not null default 0,
  total_failed integer not null default 0,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_campaigns_transport_check
    check (transport in ('evolution', 'cloud_api')),
  constraint whatsapp_campaigns_audience_type_check
    check (audience_type in ('all', 'tag', 'funnel_stage')),
  constraint whatsapp_campaigns_status_check
    check (status in ('draft', 'scheduled', 'processing', 'completed', 'cancelled', 'failed'))
);

create index if not exists whatsapp_campaigns_tenant_status_idx
  on public.whatsapp_campaigns (tenant_id, status, scheduled_at);

create table if not exists public.lead_journeys (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  remote_jid text not null,
  phone text not null,
  lead_id uuid null references public.leads(id) on delete set null,
  agent_id text null,
  rule_id uuid null references public.lead_distribution_rules(id) on delete set null,
  campaign_id uuid null references public.whatsapp_campaigns(id) on delete set null,
  connection_id text null,
  source text not null,
  source_ref text null,
  page_id text null,
  form_id text null,
  status text not null default 'active',
  conflict_policy text not null default 'latest_wins',
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_journeys_source_check
    check (source in ('meta_form', 'whatsapp_direct', 'whatsapp_campaign', 'manual')),
  constraint lead_journeys_status_check
    check (status in ('active', 'superseded', 'manual_review', 'closed')),
  constraint lead_journeys_conflict_policy_check
    check (conflict_policy in ('latest_wins', 'priority_wins', 'keep_until_inactive', 'manual_review'))
);

create unique index if not exists lead_journeys_source_ref_unique_idx
  on public.lead_journeys (tenant_id, source, source_ref)
  where source_ref is not null;

create unique index if not exists lead_journeys_one_active_per_contact_idx
  on public.lead_journeys (tenant_id, remote_jid)
  where status = 'active';

create index if not exists lead_journeys_contact_history_idx
  on public.lead_journeys (tenant_id, remote_jid, started_at desc);

create index if not exists lead_journeys_lead_history_idx
  on public.lead_journeys (tenant_id, lead_id, started_at desc)
  where lead_id is not null;

create index if not exists lead_journeys_rule_status_idx
  on public.lead_journeys (tenant_id, rule_id, status)
  where rule_id is not null;

alter table public.whatsapp_messages
  add column if not exists journey_id uuid null references public.lead_journeys(id) on delete set null;

alter table public.conversation_summaries
  add column if not exists journey_id uuid null references public.lead_journeys(id) on delete set null;

alter table public.agent_response_jobs
  add column if not exists journey_id uuid null references public.lead_journeys(id) on delete set null;

alter table public.follow_up_jobs
  add column if not exists journey_id uuid null references public.lead_journeys(id) on delete set null;

alter table public.conversation_events
  add column if not exists journey_id uuid null references public.lead_journeys(id) on delete set null;

alter table public.conversation_states
  add column if not exists active_journey_id uuid null references public.lead_journeys(id) on delete set null;

create index if not exists whatsapp_messages_journey_created_idx
  on public.whatsapp_messages (tenant_id, journey_id, created_at desc)
  where journey_id is not null;

create index if not exists conversation_summaries_journey_created_idx
  on public.conversation_summaries (tenant_id, journey_id, created_at desc)
  where journey_id is not null;

create index if not exists agent_response_jobs_journey_status_idx
  on public.agent_response_jobs (tenant_id, journey_id, status, scheduled_for)
  where journey_id is not null;

create index if not exists follow_up_jobs_journey_status_idx
  on public.follow_up_jobs (tenant_id, journey_id, status, scheduled_at)
  where journey_id is not null;

create table if not exists public.whatsapp_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  campaign_id uuid not null references public.whatsapp_campaigns(id) on delete cascade,
  lead_id uuid null references public.leads(id) on delete set null,
  journey_id uuid null references public.lead_journeys(id) on delete set null,
  phone text not null,
  name text null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz null,
  message_id uuid null references public.whatsapp_messages(id) on delete set null,
  last_error text null,
  opt_in_at timestamptz not null,
  opt_in_source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_campaign_recipients_status_check
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped')),
  constraint whatsapp_campaign_recipients_attempts_check
    check (attempts >= 0 and max_attempts between 1 and 10),
  unique (campaign_id, phone)
);

create index if not exists whatsapp_campaign_recipients_due_idx
  on public.whatsapp_campaign_recipients (status, next_attempt_at)
  where status in ('pending', 'failed');

create index if not exists whatsapp_campaign_recipients_tenant_campaign_idx
  on public.whatsapp_campaign_recipients (tenant_id, campaign_id, status);

create table if not exists public.lead_redistribution_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  journey_id uuid not null references public.lead_journeys(id) on delete cascade,
  rule_id uuid null references public.lead_distribution_rules(id) on delete set null,
  current_agent_id text null,
  trigger_type text not null,
  status text not null default 'pending',
  scheduled_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_error text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_redistribution_jobs_trigger_check
    check (trigger_type in ('agent_unavailable', 'delivery_failed', 'human_timeout', 'customer_silence')),
  constraint lead_redistribution_jobs_status_check
    check (status in ('pending', 'processing', 'completed', 'cancelled', 'failed')),
  constraint lead_redistribution_jobs_attempts_check
    check (attempts >= 0 and max_attempts between 1 and 10)
);

create unique index if not exists lead_redistribution_jobs_pending_unique_idx
  on public.lead_redistribution_jobs (journey_id, trigger_type)
  where status in ('pending', 'processing');

create index if not exists lead_redistribution_jobs_due_idx
  on public.lead_redistribution_jobs (status, scheduled_at)
  where status = 'pending';

alter table public.whatsapp_campaigns enable row level security;
alter table public.lead_journeys enable row level security;
alter table public.whatsapp_campaign_recipients enable row level security;
alter table public.lead_redistribution_jobs enable row level security;

revoke all on table public.whatsapp_campaigns from anon, authenticated;
revoke all on table public.lead_journeys from anon, authenticated;
revoke all on table public.whatsapp_campaign_recipients from anon, authenticated;
revoke all on table public.lead_redistribution_jobs from anon, authenticated;

grant select, insert, update, delete on table public.whatsapp_campaigns to service_role;
grant select, insert, update, delete on table public.lead_journeys to service_role;
grant select, insert, update, delete on table public.whatsapp_campaign_recipients to service_role;
grant select, insert, update, delete on table public.lead_redistribution_jobs to service_role;

comment on table public.lead_journeys is
  'Isolated omnichannel journeys. Only messages and jobs with the same journey may enter an agent context.';

comment on column public.lead_journeys.source_ref is
  'Idempotency key from the originating leadgen event, campaign recipient or explicit workflow.';

comment on table public.whatsapp_campaigns is
  'Durable WhatsApp campaigns; transport is separate from channel authorization.';

comment on table public.lead_redistribution_jobs is
  'Auditable redistribution queue. Only agents explicitly listed by the originating rule are eligible.';

create or replace function public.activate_lead_journey(
  p_tenant_id text,
  p_remote_jid text,
  p_phone text,
  p_lead_id uuid,
  p_agent_id text,
  p_rule_id uuid,
  p_campaign_id uuid,
  p_connection_id text,
  p_source text,
  p_source_ref text,
  p_page_id text,
  p_form_id text,
  p_conflict_policy text default 'latest_wins',
  p_inactivity_minutes integer default 1440,
  p_metadata jsonb default '{}'::jsonb
)
returns public.lead_journeys
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.lead_journeys;
  v_current public.lead_journeys;
  v_created public.lead_journeys;
  v_new_priority integer := 999;
  v_current_priority integer := 999;
  v_next_status text := 'active';
begin
  if p_tenant_id is null or p_remote_jid is null or p_phone is null then
    raise exception 'tenant_id, remote_jid and phone are required';
  end if;

  if p_source not in ('meta_form', 'whatsapp_direct', 'whatsapp_campaign', 'manual') then
    raise exception 'invalid journey source';
  end if;

  if p_conflict_policy not in ('latest_wins', 'priority_wins', 'keep_until_inactive', 'manual_review') then
    raise exception 'invalid conflict policy';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_remote_jid, 0));

  if p_source_ref is not null then
    select *
      into v_existing
      from public.lead_journeys
     where tenant_id = p_tenant_id
       and source = p_source
       and source_ref = p_source_ref
     limit 1;
    if found then
      return v_existing;
    end if;
  end if;

  select *
    into v_current
    from public.lead_journeys
   where tenant_id = p_tenant_id
     and remote_jid = p_remote_jid
     and status = 'active'
   order by started_at desc
   limit 1
   for update;

  if p_rule_id is not null then
    select coalesce(order_index, 999)
      into v_new_priority
      from public.lead_distribution_rules
     where tenant_id = p_tenant_id
       and id = p_rule_id;
  end if;

  if v_current.id is not null and v_current.rule_id is not null then
    select coalesce(order_index, 999)
      into v_current_priority
      from public.lead_distribution_rules
     where tenant_id = p_tenant_id
       and id = v_current.rule_id;
  end if;

  if v_current.id is not null then
    case p_conflict_policy
      when 'latest_wins' then
        update public.lead_journeys
           set status = 'superseded',
               ended_at = now(),
               updated_at = now()
         where id = v_current.id;
      when 'priority_wins' then
        if v_new_priority < v_current_priority then
          update public.lead_journeys
             set status = 'superseded',
                 ended_at = now(),
                 updated_at = now()
           where id = v_current.id;
        else
          v_next_status := 'superseded';
        end if;
      when 'keep_until_inactive' then
        if v_current.last_activity_at <= now() - make_interval(mins => greatest(1, p_inactivity_minutes)) then
          update public.lead_journeys
             set status = 'superseded',
                 ended_at = now(),
                 updated_at = now()
           where id = v_current.id;
        else
          v_next_status := 'superseded';
        end if;
      when 'manual_review' then
        update public.lead_journeys
           set status = 'manual_review',
               updated_at = now()
         where id = v_current.id;
        v_next_status := 'manual_review';
    end case;
  end if;

  insert into public.lead_journeys (
    tenant_id,
    remote_jid,
    phone,
    lead_id,
    agent_id,
    rule_id,
    campaign_id,
    connection_id,
    source,
    source_ref,
    page_id,
    form_id,
    status,
    conflict_policy,
    metadata
  )
  values (
    p_tenant_id,
    p_remote_jid,
    p_phone,
    p_lead_id,
    p_agent_id,
    p_rule_id,
    p_campaign_id,
    p_connection_id,
    p_source,
    p_source_ref,
    p_page_id,
    p_form_id,
    v_next_status,
    p_conflict_policy,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_created;

  return v_created;
end;
$$;

revoke all on function public.activate_lead_journey(
  text, text, text, uuid, text, uuid, uuid, text, text, text, text, text, text, integer, jsonb
) from public, anon, authenticated;

grant execute on function public.activate_lead_journey(
  text, text, text, uuid, text, uuid, uuid, text, text, text, text, text, text, integer, jsonb
) to service_role;

-- Conservative backfill: only the latest Meta assignment with complete,
-- currently authorized provenance becomes active. Unproven history stays
-- without a journey and therefore outside automatic prompts.
with proven as (
  select distinct on (l.tenant_id, regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'))
    l.tenant_id,
    l.id as lead_id,
    regexp_replace(l.phone, '\D', '', 'g') as phone,
    l.agent_id,
    l.rule_id,
    l.profile_metadata->>'meta_page_id' as page_id,
    l.profile_metadata->>'meta_form_id' as form_id,
    l.profile_metadata->>'meta_initial_outreach_leadgen_id' as leadgen_id,
    case
      when coalesce(l.profile_metadata->>'meta_initial_outreach_sent_at', '') ~ '^\d{4}-\d{2}-\d{2}T'
        then (l.profile_metadata->>'meta_initial_outreach_sent_at')::timestamptz
      else coalesce(l.updated_at, l.created_at, now())
    end as started_at,
    coalesce(r.conflict_policy, 'latest_wins') as conflict_policy,
    l.profile_metadata
  from public.leads l
  join public.lead_distribution_rules r
    on r.id = l.rule_id
   and r.tenant_id = l.tenant_id
   and r.active = true
   and r.source = 'meta_form'
  where l.agent_id is not null
    and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') <> ''
    and nullif(l.profile_metadata->>'meta_page_id', '') is not null
    and nullif(l.profile_metadata->>'meta_form_id', '') is not null
    and nullif(l.profile_metadata->>'meta_initial_outreach_leadgen_id', '') is not null
    and r.agent_ids @> to_jsonb(array[l.agent_id])
    and r.included_form_ids @> to_jsonb(array[l.profile_metadata->>'meta_form_id'])
  order by
    l.tenant_id,
    regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'),
    started_at desc
),
inserted as (
  insert into public.lead_journeys (
    tenant_id,
    remote_jid,
    phone,
    lead_id,
    agent_id,
    rule_id,
    connection_id,
    source,
    source_ref,
    page_id,
    form_id,
    status,
    conflict_policy,
    started_at,
    last_activity_at,
    metadata
  )
  select
    p.tenant_id,
    p.phone || '@s.whatsapp.net',
    p.phone,
    p.lead_id,
    p.agent_id,
    p.rule_id,
    (
      select tei.id::text
      from public.tenant_evolution_instances tei
      where tei.tenant_id = p.tenant_id
      order by tei.slot_index asc
      limit 1
    ),
    'meta_form',
    p.leadgen_id,
    p.page_id,
    p.form_id,
    'active',
    p.conflict_policy,
    p.started_at,
    coalesce(
      (
        select max(wm.created_at)
        from public.whatsapp_messages wm
        where wm.tenant_id = p.tenant_id
          and wm.lead_id = p.lead_id
          and wm.created_at >= p.started_at
      ),
      p.started_at
    ),
    jsonb_build_object('backfilled', true)
  from proven p
  on conflict do nothing
  returning id, tenant_id, remote_jid, lead_id, started_at
)
update public.conversation_states cs
   set active_journey_id = i.id,
       lead_id = coalesce(cs.lead_id, i.lead_id),
       updated_at = now()
  from inserted i
 where cs.tenant_id = i.tenant_id
   and cs.remote_jid = i.remote_jid
   and cs.channel = 'whatsapp';

update public.whatsapp_messages wm
   set journey_id = lj.id
  from public.lead_journeys lj
 where wm.tenant_id = lj.tenant_id
   and wm.lead_id = lj.lead_id
   and wm.remote_jid = lj.remote_jid
   and wm.created_at >= lj.started_at
   and wm.journey_id is null
   and lj.metadata->>'backfilled' = 'true';

notify pgrst, 'reload schema';
