-- Universal agent runtime hardening.
-- Additive/compatible migration: legacy configuration is preserved and is
-- moved to explicit review instead of being guessed or replayed.

alter table public.tenant_agents
  add column if not exists config_version bigint not null default 1,
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by text null,
  add column if not exists review_status text not null default 'ready',
  add column if not exists review_reasons text[] not null default '{}';

alter table public.tenant_agents
  drop constraint if exists tenant_agents_review_status_check;
alter table public.tenant_agents
  add constraint tenant_agents_review_status_check
  check (review_status in ('ready', 'action_required'));

create index if not exists tenant_agents_tenant_archived_idx
  on public.tenant_agents (tenant_id, archived_at, active);

-- Agenda legacy sem fuso explícito fica visível para revisão. O atendimento
-- geral continua ativo; somente o motor de agenda deve observar este motivo.
update public.tenant_agents a
   set review_status = 'action_required',
       review_reasons = array(
         select distinct reason
           from unnest(coalesce(a.review_reasons, '{}') || array['agenda_timezone_required']) reason
       ),
       updated_at = a.updated_at
 where a.metadata->>'agendaAutomationEnabled' = 'true'
   and not exists (
     select 1
       from pg_timezone_names tz
      where tz.name = nullif(a.metadata->>'timezone', '')
   );

-- A time-restricted follow-up also needs an explicit timezone. The general
-- agent remains active; only this resource is held for operator review.
update public.tenant_agents a
   set review_status = 'action_required',
       review_reasons = array(
         select distinct reason
           from unnest(coalesce(a.review_reasons, '{}') || array['follow_up_timezone_required']) reason
       ),
       updated_at = a.updated_at
 where a.metadata #>> '{followUpInteligente,ativo}' = 'true'
   and coalesce(a.metadata #>> '{followUpInteligente,usarHorarioComercial}', 'true') = 'true'
   and not exists (
     select 1
       from pg_timezone_names tz
      where tz.name = case
        when coalesce(btrim(a.metadata->>'timezone'), '') <> ''
          then btrim(a.metadata->>'timezone')
        else nullif(btrim(a.metadata #>> '{followUpInteligente,timezone}'), '')
      end
   );

-- Runtime may discover a legacy invalid configuration after the initial
-- migration. Adding the review reason is atomic and restricted to the two
-- time-dependent resources supported by this runtime.
create or replace function public.mark_agent_runtime_review_reason_v1(
  p_tenant_id text,
  p_agent_id text,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_reason not in ('agenda_timezone_required', 'follow_up_timezone_required') then
    raise exception 'agent_runtime_review_reason_not_allowed';
  end if;

  update public.tenant_agents
     set review_status = 'action_required',
         review_reasons = array(
           select distinct reason
             from unnest(coalesce(review_reasons, '{}') || array[p_reason]) reason
         )
   where tenant_id = p_tenant_id
     and agent_id = p_agent_id
     and archived_at is null;

  return found;
end;
$$;

revoke all on function public.mark_agent_runtime_review_reason_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_agent_runtime_review_reason_v1(text, text, text)
  to service_role;

update public.tenant_agents a
   set review_status = 'action_required',
       review_reasons = array(
         select distinct reason
           from unnest(coalesce(a.review_reasons, '{}') || array['handoff_configuration_invalid']) reason
       ),
       updated_at = a.updated_at
 where a.metadata->>'ctaHandoffAtivo' = 'true'
   and (
     coalesce(btrim(a.metadata->>'handoffNumero'), '') = ''
     or coalesce(btrim(a.metadata->>'handoffMensagem'), '') = ''
     or case
       when jsonb_typeof(a.metadata->'handoffKeywords') = 'array'
         then jsonb_array_length(a.metadata->'handoffKeywords') = 0
           or exists (
             select 1
               from jsonb_array_elements_text(a.metadata->'handoffKeywords') as words(keyword)
              where coalesce(btrim(keyword), '') = ''
           )
       else true
     end
   );

alter table public.whatsapp_campaigns
  add column if not exists rule_id uuid null references public.lead_distribution_rules(id) on delete set null,
  add column if not exists review_reason text null;

alter table public.whatsapp_campaigns
  drop constraint if exists whatsapp_campaigns_status_check;
alter table public.whatsapp_campaigns
  add constraint whatsapp_campaigns_status_check
  check (status in ('draft', 'scheduled', 'processing', 'paused', 'review_required', 'completed', 'cancelled', 'failed'));

-- Historical sends remain untouched. Legacy campaigns are NOT bulk-flipped to
-- 'review_required' here on purpose: the currently deployed UI does not know
-- that status yet and would break rendering the campaign list in the window
-- between this migration and the deploy. `processDueWhatsAppCampaigns` already
-- moves a campaign to 'review_required' the moment it would actually send
-- without an authorized rule, so the guarantee is identical — no legacy
-- campaign can send without an exact rule — while a paused campaign that never
-- runs simply stays paused. No delayed message is replayed either way.

create index if not exists whatsapp_campaigns_rule_status_idx
  on public.whatsapp_campaigns (tenant_id, rule_id, status);

-- New response jobs carry the exact integration rule. Historical rows are
-- preserved and backfilled when their journey already proves one exact rule.
alter table public.agent_response_jobs
  add column if not exists rule_id uuid null references public.lead_distribution_rules(id) on delete set null;

update public.agent_response_jobs job
   set rule_id = journey.rule_id
  from public.lead_journeys journey
 where job.journey_id = journey.id
   and job.rule_id is null
   and journey.rule_id is not null;

create index if not exists agent_response_jobs_rule_status_idx
  on public.agent_response_jobs (tenant_id, rule_id, status)
  where rule_id is not null;

-- v4 remains available for rollback. v5 validates rule/journey/connection
-- before delegating to the proven durable burst implementation, then records
-- the rule in the same database transaction.
create or replace function public.upsert_agent_response_job_burst_v5(
  p_tenant_id text,
  p_remote_jid text,
  p_agent_id text,
  p_instance_name text,
  p_channel text,
  p_connection_id text,
  p_rule_id uuid,
  p_message_id uuid,
  p_provider_occurred_at timestamptz,
  p_received_at timestamptz,
  p_initial_seconds integer,
  p_followup_seconds integer,
  p_max_seconds integer,
  p_lead_id uuid,
  p_journey_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_journey public.lead_journeys%rowtype;
  v_rule public.lead_distribution_rules%rowtype;
  v_campaign public.whatsapp_campaigns%rowtype;
  v_job jsonb;
  v_job_id uuid;
begin
  if p_journey_id is null or p_rule_id is null
     or nullif(btrim(p_connection_id), '') is null
     or p_channel not in ('evolution', 'meta_cloud') then
    raise exception 'agent_response_job_exact_identity_required';
  end if;

  select * into v_journey
    from public.lead_journeys
   where id = p_journey_id;
  select * into v_rule
    from public.lead_distribution_rules
   where id = p_rule_id;

  if v_journey.id is null
     or v_journey.status <> 'active'
     or v_journey.expires_at is null
     or v_journey.expires_at <= now()
     or v_journey.tenant_id is distinct from p_tenant_id
     or v_journey.remote_jid is distinct from p_remote_jid
     or v_journey.agent_id is distinct from p_agent_id
     or v_journey.connection_id is distinct from p_connection_id
     or v_journey.rule_id is distinct from p_rule_id then
    raise exception 'agent_response_job_journey_mismatch';
  end if;

  if v_rule.id is null
     or not v_rule.active
     or v_rule.tenant_id is distinct from p_tenant_id
     or v_rule.connection_id is distinct from p_connection_id
     or not (coalesce(v_rule.agent_ids, '[]'::jsonb) ? p_agent_id)
     or (p_channel = 'evolution' and v_rule.transport is distinct from 'evolution')
     or (p_channel = 'meta_cloud' and v_rule.transport is distinct from 'cloud_api') then
    raise exception 'agent_response_job_rule_mismatch';
  end if;

  if v_journey.source = 'whatsapp_direct' then
    if v_rule.source <> 'whatsapp_organico'
       or case when jsonb_typeof(v_rule.agent_ids) = 'array'
            then jsonb_array_length(v_rule.agent_ids) <> 1 else true end
       or v_rule.distribution_type not in (
         'automation_agent', 'specific_agents', 'round_robin', 'all_agents'
       ) then
      raise exception 'agent_response_job_source_scope_mismatch';
    end if;
  elsif v_journey.source = 'meta_form' then
    if v_rule.source <> 'meta_form'
       or v_journey.page_id is null
       or v_journey.form_id is null
       or v_rule.page_id is distinct from v_journey.page_id
       or coalesce(v_rule.excluded_form_ids, '[]'::jsonb) ? v_journey.form_id
       or (
         coalesce(v_rule.use_all_forms, false) = false
         and not (coalesce(v_rule.included_form_ids, '[]'::jsonb) ? v_journey.form_id)
       )
       or v_rule.distribution_type not in (
         'automation_agent', 'agent_plus_seller', 'specific_agents', 'round_robin'
       ) then
      raise exception 'agent_response_job_source_scope_mismatch';
    end if;
  elsif v_journey.source = 'whatsapp_campaign' then
    if v_rule.source <> 'whatsapp_campaign'
       or case when jsonb_typeof(v_rule.agent_ids) = 'array'
            then jsonb_array_length(v_rule.agent_ids) <> 1 else true end
       or v_rule.distribution_type <> 'automation_agent'
       or v_journey.campaign_id is null then
      raise exception 'agent_response_job_source_scope_mismatch';
    end if;
    select * into v_campaign from public.whatsapp_campaigns
     where id = v_journey.campaign_id;
    if v_campaign.id is null
       or v_campaign.status not in ('scheduled', 'processing', 'paused', 'completed')
       or v_campaign.tenant_id is distinct from p_tenant_id
       or v_campaign.agent_id is distinct from p_agent_id
       or v_campaign.connection_id is distinct from p_connection_id
       or v_campaign.rule_id is distinct from p_rule_id
       or v_campaign.transport is distinct from v_rule.transport then
      raise exception 'agent_response_job_campaign_mismatch';
    end if;
  else
    raise exception 'agent_response_job_source_not_authorized';
  end if;

  select public.upsert_agent_response_job_burst_v4(
    p_tenant_id, p_remote_jid, p_agent_id, p_instance_name, p_channel,
    p_connection_id, p_message_id, p_provider_occurred_at, p_received_at,
    p_initial_seconds, p_followup_seconds, p_max_seconds, p_lead_id,
    p_journey_id
  ) into v_job;

  v_job_id := nullif(v_job->>'id', '')::uuid;
  if v_job_id is null then
    raise exception 'agent_response_job_missing_after_upsert';
  end if;
  update public.agent_response_jobs
     set rule_id = p_rule_id
   where id = v_job_id
     and tenant_id = p_tenant_id
     and journey_id = p_journey_id;
  if not found then
    raise exception 'agent_response_job_identity_changed';
  end if;
  return v_job || jsonb_build_object('rule_id', p_rule_id);
end;
$$;

revoke all on function public.upsert_agent_response_job_burst_v5(
  text,text,text,text,text,text,uuid,uuid,timestamptz,timestamptz,
  integer,integer,integer,uuid,uuid
) from public, anon, authenticated;
grant execute on function public.upsert_agent_response_job_burst_v5(
  text,text,text,text,text,text,uuid,uuid,timestamptz,timestamptz,
  integer,integer,integer,uuid,uuid
) to service_role;

alter table public.follow_up_jobs
  add column if not exists channel text null,
  add column if not exists connection_id text null,
  add column if not exists rule_id uuid null references public.lead_distribution_rules(id) on delete set null,
  add column if not exists automation_epoch bigint null,
  add column if not exists claim_token uuid null,
  add column if not exists claimed_at timestamptz null,
  add column if not exists claim_expires_at timestamptz null,
  add column if not exists heartbeat_at timestamptz null;

alter table public.agent_followup_events
  drop constraint if exists agent_followup_events_event_type_check;
alter table public.agent_followup_events
  add constraint agent_followup_events_event_type_check
  check (event_type in (
    'follow_up_evaluated', 'follow_up_skipped',
    'follow_up_blocked_by_human', 'follow_up_sent', 'follow_up_failed',
    'cooldown_active', 'spam_risk_detected', 'sla_breached',
    'follow_up_closed', 'business_hours_skipped', 'customer_replied',
    'follow_up_rescheduled_retomada', 'follow_up_exhausted'
  ));

alter table public.follow_up_jobs
  drop constraint if exists follow_up_jobs_channel_check;
alter table public.follow_up_jobs
  add constraint follow_up_jobs_channel_check
  check (channel is null or channel in ('evolution', 'meta_cloud'));

update public.follow_up_jobs f
   set connection_id = coalesce(f.connection_id, j.connection_id),
       rule_id = coalesce(f.rule_id, j.rule_id),
       channel = coalesce(
         f.channel,
         case
           when c.transport = 'evolution' then 'evolution'
           when c.transport in ('cloud_api', 'meta_cloud') then 'meta_cloud'
         end,
         case
           when r.transport = 'evolution' then 'evolution'
           when r.transport in ('cloud_api', 'meta_cloud') then 'meta_cloud'
         end
       )
  from public.lead_journeys j
  left join public.whatsapp_campaigns c on c.id = j.campaign_id
 left join public.lead_distribution_rules r on r.id = j.rule_id
 where f.journey_id = j.id;

-- `automation_epoch` acabou de ser criada, então TODA linha existente está
-- nula — sem este backfill, a limpeza logo abaixo cancelaria follow-ups
-- legítimos, já agendados para leads reais, apenas por causa da coluna nova.
-- A época verdadeira é a da conversa: preenchê-la aqui preserva o job e
-- mantém a garantia original (um takeover posterior invalida a época e o
-- follow-up é descartado na hora do envio, como deve ser).
update public.follow_up_jobs f
   set automation_epoch = s.automation_epoch
  from public.conversation_states s
 where f.automation_epoch is null
   and s.tenant_id = f.tenant_id
   and s.remote_jid = f.remote_jid
   and s.channel = 'whatsapp';

-- Old queued work that cannot be tied to one exact authorization is retained
-- for audit but never guessed or replayed after the rollout.
update public.follow_up_jobs
   set status = 'cancelled',
       last_error = 'legacy_exact_omnichannel_identity_missing',
       updated_at = now()
 where status in ('pending', 'processing')
   and (
     journey_id is null or rule_id is null or connection_id is null or
     channel is null or channel not in ('evolution', 'meta_cloud') or automation_epoch is null
   );

create index if not exists follow_up_jobs_claim_expiry_idx
  on public.follow_up_jobs (claim_expires_at)
  where status = 'processing';
create index if not exists follow_up_jobs_channel_due_idx
  on public.follow_up_jobs (channel, status, scheduled_at)
  where status in ('pending', 'processing');

create or replace function public.clear_follow_up_claim_v2()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status <> 'processing' then
    new.claim_token := null;
    new.claimed_at := null;
    new.claim_expires_at := null;
    new.heartbeat_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists follow_up_jobs_clear_claim_v2 on public.follow_up_jobs;
create trigger follow_up_jobs_clear_claim_v2
before insert or update of status on public.follow_up_jobs
for each row execute function public.clear_follow_up_claim_v2();

revoke all on function public.clear_follow_up_claim_v2()
  from public, anon, authenticated;

alter table public.external_api_operations
  add column if not exists review_required boolean not null default false,
  add column if not exists review_reason text null;

update public.external_api_operations
   set enabled = false,
       review_required = true,
       review_reason = 'get_only_required',
       updated_at = now()
 where method <> 'GET';

alter table public.external_api_operations
  drop constraint if exists external_api_operations_method_check;
alter table public.external_api_operations
  add constraint external_api_operations_method_check
  check (
    method = 'GET'
    or (method = 'POST' and enabled = false and review_required = true)
  );

-- A single atomic claim recovers expired workers and prevents two runtimes from
-- processing the same follow-up. New work without exact omnichannel identity is
-- deliberately not claimable.
create or replace function public.claim_follow_up_jobs_v2(
  p_limit integer default 10,
  p_claim_seconds integer default 90
)
returns setof public.follow_up_jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_claim_seconds integer := greatest(30, least(coalesce(p_claim_seconds, 90), 300));
begin
  update public.follow_up_jobs
     set status = 'pending',
         claim_token = null,
         claimed_at = null,
         claim_expires_at = null,
         heartbeat_at = null,
         last_error = 'claim_expired_recovered',
         updated_at = v_now
   where status = 'processing'
     and claim_expires_at is not null
     and claim_expires_at <= v_now;

  return query
  with due as (
    select id
      from public.follow_up_jobs
     where status = 'pending'
       and scheduled_at <= v_now
       and journey_id is not null
       and rule_id is not null
       and connection_id is not null
       and automation_epoch is not null
       and channel in ('evolution', 'meta_cloud')
     order by priority asc, scheduled_at asc, id asc
     for update skip locked
     limit v_limit
  )
  update public.follow_up_jobs f
     set status = 'processing',
         claim_token = gen_random_uuid(),
         claimed_at = v_now,
         claim_expires_at = v_now + make_interval(secs => v_claim_seconds),
         heartbeat_at = v_now,
         updated_at = v_now
    from due
   where f.id = due.id
  returning f.*;
end;
$$;

revoke all on function public.claim_follow_up_jobs_v2(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_follow_up_jobs_v2(integer, integer)
  to service_role;

-- Same atomic contract for explicit retries/tests that address a single job.
-- The business attempt counter is intentionally not incremented by a claim;
-- it advances only after a provider attempt.
create or replace function public.claim_follow_up_job_v2(
  p_job_id uuid,
  p_claim_seconds integer default 90
)
returns public.follow_up_jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claim_seconds integer := greatest(30, least(coalesce(p_claim_seconds, 90), 300));
  v_claimed public.follow_up_jobs;
begin
  update public.follow_up_jobs f
     set status = 'processing',
         claim_token = gen_random_uuid(),
         claimed_at = v_now,
         claim_expires_at = v_now + make_interval(secs => v_claim_seconds),
         heartbeat_at = v_now,
         updated_at = v_now
   where f.id = p_job_id
     and f.journey_id is not null
     and f.rule_id is not null
     and f.connection_id is not null
     and f.automation_epoch is not null
     and f.channel in ('evolution', 'meta_cloud')
     and (
       (f.status = 'pending' and f.scheduled_at <= v_now)
       or
       (f.status = 'processing' and f.claim_expires_at is not null and f.claim_expires_at <= v_now)
     )
  returning f.* into v_claimed;

  return v_claimed;
end;
$$;

revoke all on function public.claim_follow_up_job_v2(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_follow_up_job_v2(uuid, integer)
  to service_role;

create or replace function public.heartbeat_follow_up_job_v2(
  p_job_id uuid,
  p_claim_token uuid,
  p_extend_seconds integer default 90
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.follow_up_jobs
     set heartbeat_at = clock_timestamp(),
         claim_expires_at = clock_timestamp() + make_interval(
           secs => greatest(30, least(coalesce(p_extend_seconds, 90), 300))
         ),
         updated_at = clock_timestamp()
   where id = p_job_id
     and status = 'processing'
     and claim_token = p_claim_token
     and claim_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.heartbeat_follow_up_job_v2(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.heartbeat_follow_up_job_v2(uuid, uuid, integer)
  to service_role;

-- Recovery is kept inside PostgreSQL so an old worker can never reset a newer
-- claim by racing a read followed by a write in application code.
create or replace function public.recover_expired_follow_up_jobs_v2(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_recovered integer;
begin
  update public.follow_up_jobs
     set status = 'pending',
         claim_token = null,
         claimed_at = null,
         claim_expires_at = null,
         heartbeat_at = null,
         last_error = 'claim_expired_recovered',
         updated_at = p_now
   where status = 'processing'
     and claim_expires_at is not null
     and claim_expires_at <= p_now;
  get diagnostics v_recovered = row_count;
  return v_recovered;
end;
$$;

revoke all on function public.recover_expired_follow_up_jobs_v2(timestamptz)
  from public, anon, authenticated;
grant execute on function public.recover_expired_follow_up_jobs_v2(timestamptz)
  to service_role;

-- Every terminal/reschedule transition is guarded by the live claim. When a
-- successful send needs another attempt, the current row and its successor are
-- committed atomically; a retried RPC cannot create a duplicate successor.
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
as $$
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

  if p_status = 'sent' then
    insert into public.follow_up_jobs (
      tenant_id, agent_id, remote_jid, lead_id, journey_id,
      channel, connection_id, rule_id, automation_epoch,
      scheduled_at, attempts, max_attempts, status,
      follow_up_type, priority, context_summary
    ) values (
      v_job.tenant_id, v_job.agent_id, v_job.remote_jid, v_job.lead_id,
      v_job.journey_id, v_job.channel, v_job.connection_id, v_job.rule_id,
      v_job.automation_epoch, p_next_scheduled_at,
      coalesce(p_attempts, v_job.attempts), v_job.max_attempts, 'pending',
      'silence', coalesce(p_priority, v_job.priority), v_job.context_summary
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
$$;

revoke all on function public.finish_follow_up_job_v2(
  uuid, uuid, text, integer, timestamptz, text, integer, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finish_follow_up_job_v2(
  uuid, uuid, text, integer, timestamptz, text, integer, text, timestamptz
) to service_role;

-- Inbound/manual activity invalidates both queued and in-flight follow-ups in
-- one statement. Clearing an in-flight status also clears its lease through the
-- trigger above, so the old worker's next heartbeat/finalization fails closed.
create or replace function public.cancel_active_follow_up_jobs_v2(
  p_tenant_id text,
  p_remote_jid text,
  p_reason text,
  p_journey_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cancelled integer;
begin
  update public.follow_up_jobs
     set status = 'cancelled',
         last_error = coalesce(nullif(trim(p_reason), ''), 'cancelled'),
         updated_at = clock_timestamp()
   where tenant_id = p_tenant_id
     and remote_jid = p_remote_jid
     and status in ('pending', 'processing')
     and (p_journey_id is null or journey_id = p_journey_id);
  get diagnostics v_cancelled = row_count;
  return v_cancelled;
end;
$$;

revoke all on function public.cancel_active_follow_up_jobs_v2(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_active_follow_up_jobs_v2(text, text, text, uuid)
  to service_role;

-- Dependency report used before pause/archive. Arrays of rule agents do not
-- provide a foreign key, so every dependency is checked under the tenant lock.
create or replace function public.get_agent_dependency_report_v1(
  p_tenant_id text,
  p_agent_id text
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rules', (
      select count(*) from public.lead_distribution_rules r
       where r.tenant_id = p_tenant_id and r.active
         and coalesce(r.agent_ids, '[]'::jsonb) ? p_agent_id
    ),
    'journeys', (
      select count(*) from public.lead_journeys j
       where j.tenant_id = p_tenant_id and j.agent_id = p_agent_id
         and j.status = 'active' and coalesce(j.expires_at, 'infinity'::timestamptz) > now()
    ),
    'responseJobs', (
      select count(*) from public.agent_response_jobs j
       where j.tenant_id = p_tenant_id and j.agent_id = p_agent_id
         and j.status in ('pending', 'processing')
    ),
    'followUps', (
      select count(*) from public.follow_up_jobs f
       where f.tenant_id = p_tenant_id and f.agent_id = p_agent_id
         and f.status in ('pending', 'processing')
    ),
    'campaigns', (
      select count(*) from public.whatsapp_campaigns c
       where c.tenant_id = p_tenant_id and c.agent_id = p_agent_id
         and c.status in ('scheduled', 'processing', 'paused')
    ),
    'metaMappings', (
      select count(*) from public.meta_form_agent_mapping m
       where m.tenant_id = p_tenant_id and m.agent_id = p_agent_id
    ),
    'organicConnections', (
      select count(*) from public.tenant_evolution_instances i
       where i.tenant_id = p_tenant_id and i.organic_agent_id = p_agent_id
    )
  );
$$;

revoke all on function public.get_agent_dependency_report_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.get_agent_dependency_report_v1(text, text)
  to service_role;

-- Saves configuration and owner-controlled connector links in the same
-- transaction. The expected version prevents silent last-write-wins.
create or replace function public.save_tenant_agent_v2(
  p_tenant_id text,
  p_agent_id text,
  p_create_only boolean,
  p_expected_version bigint,
  p_display_name text,
  p_system_prompt text,
  p_active boolean,
  p_metadata jsonb,
  p_voice_id text,
  p_response_mode text,
  p_crm_auto_move_enabled boolean,
  p_crm_target_funnel_id text,
  p_crm_target_column_id text,
  p_crm_target_status text,
  p_review_status text,
  p_review_reasons text[],
  p_replace_connectors boolean,
  p_connector_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.tenant_agents%rowtype;
  v_saved public.tenant_agents%rowtype;
  v_dependencies jsonb;
  v_requested integer := 0;
  v_allowed integer := 0;
begin
  select count(distinct connector_id) into v_requested
    from unnest(coalesce(p_connector_ids, '{}'::uuid[])) as connector_id;
  if coalesce(btrim(p_tenant_id), '') = '' or coalesce(btrim(p_agent_id), '') = '' then
    raise exception 'agent_identity_required';
  end if;
  if coalesce(btrim(p_display_name), '') = '' or coalesce(btrim(p_system_prompt), '') = '' then
    raise exception 'agent_required_fields';
  end if;
  if p_response_mode not in ('text', 'audio') then
    raise exception 'agent_response_mode_invalid';
  end if;
  if p_review_status not in ('ready', 'action_required') then
    raise exception 'agent_review_status_invalid';
  end if;
  if coalesce(p_active, false) and coalesce(p_review_reasons, '{}') && array[
    'agent_context_overflow',
    'agent_model_context_window_unknown',
    'agent_invalid_language'
  ]::text[] then
    raise exception 'agent_activation_blocked';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'tenant-agent:' || p_tenant_id || ':' || p_agent_id, 0
  ));

  select * into v_current
    from public.tenant_agents
   where tenant_id = p_tenant_id and agent_id = p_agent_id
   for update;

  if coalesce(p_create_only, false) then
    if found then raise exception 'agent_already_exists'; end if;
  else
    if not found then raise exception 'agent_not_found'; end if;
    if p_expected_version is null then raise exception 'agent_version_required'; end if;
    if v_current.config_version is distinct from p_expected_version then
      raise exception 'agent_version_conflict';
    end if;
    if v_current.active and not coalesce(p_active, false) then
      select public.get_agent_dependency_report_v1(p_tenant_id, p_agent_id)
        into v_dependencies;
      if coalesce((v_dependencies->>'rules')::integer, 0)
       + coalesce((v_dependencies->>'journeys')::integer, 0)
       + coalesce((v_dependencies->>'responseJobs')::integer, 0)
       + coalesce((v_dependencies->>'followUps')::integer, 0)
       + coalesce((v_dependencies->>'campaigns')::integer, 0)
       + coalesce((v_dependencies->>'metaMappings')::integer, 0)
       + coalesce((v_dependencies->>'organicConnections')::integer, 0) > 0 then
        return jsonb_build_object(
          'ok', false,
          'code', 'agent_dependencies_active',
          'dependencies', v_dependencies
        );
      end if;
    end if;
  end if;

  if coalesce(p_replace_connectors, false) and v_requested > 0 then
    select count(*) into v_allowed
      from public.external_api_connectors c
     where c.tenant_id = p_tenant_id
       and c.id = any(p_connector_ids)
       and c.enabled;
    if v_allowed <> v_requested then
      raise exception 'external_api_connector_not_available';
    end if;
  end if;

  if coalesce(p_create_only, false) then
    insert into public.tenant_agents (
      tenant_id, agent_id, display_name, system_prompt, model, active,
      metadata, voice_id, response_mode, crm_auto_move_enabled,
      crm_target_funnel_id, crm_target_column_id, crm_target_status,
      config_version, review_status, review_reasons, archived_at, updated_at
    ) values (
      p_tenant_id, p_agent_id, btrim(p_display_name), p_system_prompt, null,
      coalesce(p_active, false), coalesce(p_metadata, '{}'::jsonb), p_voice_id,
      p_response_mode, coalesce(p_crm_auto_move_enabled, false),
      p_crm_target_funnel_id, p_crm_target_column_id, p_crm_target_status,
      1, p_review_status, coalesce(p_review_reasons, '{}'), null, now()
    ) returning * into v_saved;
  else
    update public.tenant_agents
       set display_name = btrim(p_display_name),
           system_prompt = p_system_prompt,
           active = coalesce(p_active, false),
           metadata = coalesce(p_metadata, '{}'::jsonb),
           voice_id = p_voice_id,
           response_mode = p_response_mode,
           crm_auto_move_enabled = coalesce(p_crm_auto_move_enabled, false),
           crm_target_funnel_id = p_crm_target_funnel_id,
           crm_target_column_id = p_crm_target_column_id,
           crm_target_status = p_crm_target_status,
           config_version = config_version + 1,
           review_status = p_review_status,
           review_reasons = coalesce(p_review_reasons, '{}'),
           archived_at = null,
           archived_by = null,
           updated_at = now()
     where tenant_id = p_tenant_id and agent_id = p_agent_id
     returning * into v_saved;
  end if;

  if coalesce(p_replace_connectors, false) then
    delete from public.agent_external_api_connectors
     where tenant_id = p_tenant_id and agent_id = p_agent_id;
    if v_requested > 0 then
      insert into public.agent_external_api_connectors (
        tenant_id, agent_id, connector_id
      )
      select p_tenant_id, p_agent_id, connector_id
        from unnest(p_connector_ids) as connector_id
       group by connector_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'configVersion', v_saved.config_version,
    'row', to_jsonb(v_saved)
  );
end;
$$;

revoke all on function public.save_tenant_agent_v2(
  text,text,boolean,bigint,text,text,boolean,jsonb,text,text,boolean,text,text,text,text,text[],boolean,uuid[]
) from public, anon, authenticated;
grant execute on function public.save_tenant_agent_v2(
  text,text,boolean,bigint,text,text,boolean,jsonb,text,text,boolean,text,text,text,text,text[],boolean,uuid[]
) to service_role;

create or replace function public.archive_tenant_agent_v1(
  p_tenant_id text,
  p_agent_id text,
  p_expected_version bigint,
  p_archived_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.tenant_agents%rowtype;
  v_dependencies jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'tenant-agent:' || p_tenant_id || ':' || p_agent_id, 0
  ));
  select * into v_current from public.tenant_agents
   where tenant_id = p_tenant_id and agent_id = p_agent_id for update;
  if not found then raise exception 'agent_not_found'; end if;
  if p_expected_version is null or v_current.config_version is distinct from p_expected_version then
    raise exception 'agent_version_conflict';
  end if;
  select public.get_agent_dependency_report_v1(p_tenant_id, p_agent_id)
    into v_dependencies;
  if coalesce((v_dependencies->>'rules')::integer, 0)
   + coalesce((v_dependencies->>'journeys')::integer, 0)
   + coalesce((v_dependencies->>'responseJobs')::integer, 0)
   + coalesce((v_dependencies->>'followUps')::integer, 0)
   + coalesce((v_dependencies->>'campaigns')::integer, 0)
   + coalesce((v_dependencies->>'metaMappings')::integer, 0)
   + coalesce((v_dependencies->>'organicConnections')::integer, 0) > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'agent_dependencies_active',
      'dependencies', v_dependencies
    );
  end if;
  update public.tenant_agents
     set active = false,
         archived_at = now(),
         archived_by = nullif(btrim(p_archived_by), ''),
         config_version = config_version + 1,
         updated_at = now()
   where tenant_id = p_tenant_id and agent_id = p_agent_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.archive_tenant_agent_v1(text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.archive_tenant_agent_v1(text, text, bigint, text)
  to service_role;

-- The existing conversation_events table intentionally has no browser read or
-- write grants. This RPC runs as the calling service_role and uses INSERT ...
-- RETURNING, which requires both INSERT and SELECT on the returned columns.
-- Keep the minimum server-only privileges explicit so a human takeover cannot
-- roll back after the state row was locked.
grant select, insert on table public.conversation_events to service_role;

-- Human control and event audit commit together under the same conversation
-- lock. Returning to automation requires the original journey/rule to still be
-- valid; no default agent or connection is inferred.
create or replace function public.set_conversation_operation_v3(
  p_tenant_id text,
  p_remote_jid text,
  p_lead_id uuid,
  p_agent_id text,
  p_mode text,
  p_human_paused boolean,
  p_paused_reason text,
  p_paused_by text,
  p_handoff_suggested boolean,
  p_handoff_reason text,
  p_assigned_human_id text,
  p_assigned_human_name text,
  p_transferred_from text,
  p_transferred_to text,
  p_transfer_reason text,
  p_expected_epoch bigint,
  p_event_type text,
  p_event_title text,
  p_event_detail text,
  p_actor_type text,
  p_actor_id text,
  p_actor_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_state public.conversation_states%rowtype;
  v_journey public.lead_journeys%rowtype;
  v_rule public.lead_distribution_rules%rowtype;
  v_campaign public.whatsapp_campaigns%rowtype;
  v_event jsonb := null;
begin
  if p_mode not in ('automation', 'waiting_human', 'human') then
    raise exception 'invalid_conversation_mode';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'agent-conversation:' || p_tenant_id || ':' || p_remote_jid, 0
  ));
  select * into v_state
    from public.conversation_states
   where tenant_id = p_tenant_id and remote_jid = p_remote_jid and channel = 'whatsapp'
   for update;
  if found and p_expected_epoch is not null
     and v_state.automation_epoch is distinct from p_expected_epoch then
    raise exception 'automation_epoch_stale';
  end if;

  if p_mode = 'automation' then
    if v_state.id is null or v_state.active_journey_id is null then
      raise exception 'automation_journey_required';
    end if;
    select * into v_journey from public.lead_journeys
     where id = v_state.active_journey_id for update;
    select * into v_rule from public.lead_distribution_rules
     where id = v_journey.rule_id;
    if v_journey.id is null or v_journey.tenant_id is distinct from p_tenant_id
       or v_journey.remote_jid is distinct from p_remote_jid
       or v_journey.status <> 'active'
       or v_journey.expires_at is null or v_journey.expires_at <= now()
       or v_journey.connection_id is null
       or v_journey.agent_id is null
       or nullif(btrim(p_agent_id), '') is null
       or p_agent_id is distinct from v_journey.agent_id
       or (p_lead_id is not null and p_lead_id is distinct from v_journey.lead_id)
       or v_rule.id is null or not v_rule.active
       or v_rule.tenant_id is distinct from p_tenant_id
       or v_rule.connection_id is distinct from v_journey.connection_id
       or not (coalesce(v_rule.agent_ids, '[]'::jsonb) ? v_journey.agent_id) then
      raise exception 'automation_authorization_invalid';
    end if;

    if v_journey.source = 'whatsapp_direct' then
      if v_rule.source <> 'whatsapp_organico'
         or v_rule.transport not in ('evolution', 'cloud_api')
         or case when jsonb_typeof(v_rule.agent_ids) = 'array'
              then jsonb_array_length(v_rule.agent_ids) <> 1 else true end
         or v_rule.distribution_type not in (
           'automation_agent', 'specific_agents', 'round_robin', 'all_agents'
         ) then
        raise exception 'automation_authorization_invalid';
      end if;
    elsif v_journey.source = 'meta_form' then
      if v_rule.source <> 'meta_form'
         or v_rule.transport not in ('evolution', 'cloud_api')
         or v_journey.page_id is null
         or v_journey.form_id is null
         or v_rule.page_id is distinct from v_journey.page_id
         or coalesce(v_rule.excluded_form_ids, '[]'::jsonb) ? v_journey.form_id
         or (
           coalesce(v_rule.use_all_forms, false) = false
           and not (coalesce(v_rule.included_form_ids, '[]'::jsonb) ? v_journey.form_id)
         )
         or v_rule.distribution_type not in (
           'automation_agent', 'agent_plus_seller', 'specific_agents', 'round_robin'
         ) then
        raise exception 'automation_authorization_invalid';
      end if;
    elsif v_journey.source = 'whatsapp_campaign' then
      if v_rule.source <> 'whatsapp_campaign'
         or v_rule.transport not in ('evolution', 'cloud_api')
         or case when jsonb_typeof(v_rule.agent_ids) = 'array'
              then jsonb_array_length(v_rule.agent_ids) <> 1 else true end
         or v_rule.distribution_type <> 'automation_agent'
         or v_journey.campaign_id is null then
        raise exception 'automation_authorization_invalid';
      end if;
      select * into v_campaign from public.whatsapp_campaigns
       where id = v_journey.campaign_id;
      if v_campaign.id is null
         or v_campaign.status not in ('scheduled', 'processing', 'paused', 'completed')
         or v_campaign.tenant_id is distinct from p_tenant_id
         or v_campaign.agent_id is distinct from v_journey.agent_id
         or v_campaign.connection_id is distinct from v_journey.connection_id
         or v_campaign.rule_id is distinct from v_rule.id
         or v_campaign.transport is distinct from v_rule.transport then
        raise exception 'automation_authorization_invalid';
      end if;
    else
      raise exception 'automation_authorization_invalid';
    end if;
  end if;

  insert into public.conversation_states (
    tenant_id, remote_jid, channel, lead_id, agent_id, conversation_mode,
    human_paused, paused_reason, paused_by, handoff_suggested, handoff_reason,
    assigned_human_id, assigned_human_name, transferred_from, transferred_to,
    transfer_reason, status, paused_at, resumed_at, automation_epoch, updated_at
  ) values (
    p_tenant_id, p_remote_jid, 'whatsapp', p_lead_id, p_agent_id, p_mode,
    p_human_paused, p_paused_reason, p_paused_by, p_handoff_suggested,
    p_handoff_reason, p_assigned_human_id, p_assigned_human_name,
    p_transferred_from, p_transferred_to, p_transfer_reason,
    case when p_human_paused then 'human_paused' else 'active' end,
    case when p_human_paused then now() else null end,
    case when p_human_paused then null else now() end, 1, now()
  )
  on conflict (tenant_id, remote_jid, channel) do update set
    lead_id = coalesce(excluded.lead_id, conversation_states.lead_id),
    agent_id = coalesce(excluded.agent_id, conversation_states.agent_id),
    conversation_mode = excluded.conversation_mode,
    human_paused = excluded.human_paused,
    paused_reason = excluded.paused_reason,
    paused_by = excluded.paused_by,
    handoff_suggested = excluded.handoff_suggested,
    handoff_reason = excluded.handoff_reason,
    assigned_human_id = excluded.assigned_human_id,
    assigned_human_name = excluded.assigned_human_name,
    transferred_from = excluded.transferred_from,
    transferred_to = excluded.transferred_to,
    transfer_reason = excluded.transfer_reason,
    status = excluded.status,
    paused_at = case when excluded.human_paused then now() else conversation_states.paused_at end,
    resumed_at = case when excluded.human_paused then conversation_states.resumed_at else now() end,
    automation_epoch = conversation_states.automation_epoch + 1,
    updated_at = now()
  returning * into v_state;

  if p_mode <> 'automation' or p_human_paused then
    update public.agent_response_jobs
       set status = 'cancelled', failed_reason = coalesce(p_paused_reason, 'human_control'),
           claim_token = null, claim_expires_at = null, locked_at = null,
           completed_at = now(), updated_at = now()
     where tenant_id = p_tenant_id and remote_jid = p_remote_jid
       and status in ('pending', 'processing');
    update public.agent_outbound_outbox
       set status = 'cancelled', authorization_status = 'blocked',
           authorization_reason = coalesce(p_paused_reason, 'human_control'),
           claim_token = null, claim_expires_at = null, updated_at = now()
     where tenant_id = p_tenant_id and remote_jid = p_remote_jid
       and status in ('pending', 'processing', 'failed');
    update public.follow_up_jobs
       set status = 'cancelled', last_error = coalesce(p_paused_reason, 'human_control'),
           claim_token = null, claimed_at = null, claim_expires_at = null,
           heartbeat_at = null, updated_at = now()
     where tenant_id = p_tenant_id and remote_jid = p_remote_jid
       and status in ('pending', 'processing');
    update public.agent_agenda_pending_actions
       set state = 'rejected', updated_at = now()
     where tenant_id = p_tenant_id and remote_jid = p_remote_jid and state = 'pending';
  end if;

  if coalesce(btrim(p_event_type), '') <> '' and coalesce(btrim(p_event_title), '') <> '' then
    insert into public.conversation_events (
      tenant_id, remote_jid, lead_id, conversation_state_id, event_type,
      title, detail, actor_type, actor_id, actor_name, transferred_from,
      transferred_to, transfer_reason
    ) values (
      p_tenant_id, p_remote_jid, coalesce(p_lead_id, v_state.lead_id), v_state.id,
      p_event_type, p_event_title, p_event_detail, p_actor_type, p_actor_id,
      p_actor_name, p_transferred_from, p_transferred_to, p_transfer_reason
    ) returning to_jsonb(conversation_events) into v_event;
  end if;

  return jsonb_build_object('state', to_jsonb(v_state), 'event', v_event);
end;
$$;

revoke all on function public.set_conversation_operation_v3(
  text,text,uuid,text,text,boolean,text,text,boolean,text,text,text,text,text,text,
  bigint,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.set_conversation_operation_v3(
  text,text,uuid,text,text,boolean,text,text,boolean,text,text,text,text,text,text,
  bigint,text,text,text,text,text,text
) to service_role;

-- Replace the former campaign exception with the same exact-rule proof used
-- by every other automatic outbound.
--
-- Published as v3 instead of replacing v2 on purpose. v2 authorizes campaign
-- journeys WITHOUT requiring rule_id; production still has active campaign
-- journeys in exactly that state. Overwriting v2 would make every one of them
-- fail authorization the instant the migration landed, with no way back except
-- another migration. Keeping v2 untouched makes the rollout reversible by the
-- feature flag alone: the application calls v3 only for tenants already on the
-- rule identity, and falls back to the proven v2 for everyone else.
create or replace function public.authorize_agent_outbound_dispatch_v3(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_expected_epoch bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_out public.agent_outbound_outbox%rowtype;
  v_state public.conversation_states%rowtype;
  v_journey public.lead_journeys%rowtype;
  v_rule public.lead_distribution_rules%rowtype;
  v_campaign public.whatsapp_campaigns%rowtype;
  v_reason text := null;
begin
  select * into v_out from public.agent_outbound_outbox where id = p_outbox_id;
  if v_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'outbox_missing');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'agent-conversation:' || v_out.tenant_id || ':' || v_out.remote_jid, 0
  ));
  select * into v_out from public.agent_outbound_outbox where id = p_outbox_id for update;
  select * into v_state from public.conversation_states
   where tenant_id = v_out.tenant_id and remote_jid = v_out.remote_jid and channel = 'whatsapp'
   for update;

  if v_out.status <> 'processing' or v_out.claim_token is distinct from p_claim_token then
    v_reason := 'outbox_claim_invalid';
  elsif v_state.id is null then
    v_reason := 'conversation_state_missing';
  elsif v_state.conversation_mode is distinct from 'automation' or v_state.human_paused then
    v_reason := 'conversation_human_control';
  elsif v_state.automation_epoch is distinct from p_expected_epoch
     or v_out.automation_epoch is distinct from p_expected_epoch then
    v_reason := 'automation_epoch_stale';
  elsif v_out.journey_id is null then
    v_reason := 'journey_missing';
  elsif v_out.rule_id is null then
    v_reason := 'outbox_rule_missing';
  elsif v_out.connection_id is null then
    v_reason := 'connection_missing';
  elsif v_out.channel not in ('evolution', 'meta_cloud') then
    v_reason := 'channel_invalid';
  end if;

  if v_reason is null then
    select * into v_journey from public.lead_journeys where id = v_out.journey_id for update;
    if v_journey.id is null or v_journey.status <> 'active' then
      v_reason := 'journey_not_active';
    elsif v_journey.expires_at is null or v_journey.expires_at <= now() then
      v_reason := 'journey_expired';
    elsif v_journey.tenant_id is distinct from v_out.tenant_id
       or v_journey.remote_jid is distinct from v_out.remote_jid
       or v_journey.agent_id is distinct from v_out.agent_id then
      v_reason := 'journey_owner_mismatch';
    elsif v_journey.connection_id is null
       or v_journey.connection_id is distinct from v_out.connection_id then
      v_reason := 'journey_connection_mismatch';
    elsif v_state.active_journey_id is distinct from v_journey.id
       or v_state.agent_id is distinct from v_journey.agent_id then
      v_reason := 'conversation_journey_mismatch';
    elsif v_journey.rule_id is null then
      v_reason := 'rule_missing';
    elsif v_out.rule_id is distinct from v_journey.rule_id then
      v_reason := 'outbox_rule_mismatch';
    end if;
  end if;

  if v_reason is null then
    select * into v_rule from public.lead_distribution_rules where id = v_journey.rule_id;
    if v_rule.id is null or not v_rule.active then
      v_reason := 'rule_inactive';
    elsif v_rule.tenant_id is distinct from v_out.tenant_id
       or v_rule.connection_id is null
       or v_rule.connection_id is distinct from v_out.connection_id
       or not (coalesce(v_rule.agent_ids, '[]'::jsonb) ? v_out.agent_id) then
      v_reason := 'rule_scope_mismatch';
    elsif v_out.channel = 'evolution' and v_rule.transport is distinct from 'evolution' then
      v_reason := 'rule_transport_mismatch';
    elsif v_out.channel = 'meta_cloud' and v_rule.transport is distinct from 'cloud_api' then
      v_reason := 'rule_transport_mismatch';
    elsif v_journey.source = 'whatsapp_direct' and v_rule.source <> 'whatsapp_organico' then
      v_reason := 'direct_rule_source_mismatch';
    elsif v_journey.source = 'whatsapp_direct' and case
      when jsonb_typeof(v_rule.agent_ids) = 'array'
        then jsonb_array_length(v_rule.agent_ids) <> 1
      else true
    end then
      v_reason := 'direct_rule_ambiguous';
    elsif v_journey.source = 'whatsapp_direct'
       and v_rule.distribution_type not in ('automation_agent','specific_agents','round_robin','all_agents') then
      v_reason := 'direct_rule_distribution_invalid';
    elsif v_journey.source = 'meta_form' and v_rule.source <> 'meta_form' then
      v_reason := 'meta_rule_source_mismatch';
    elsif v_journey.source = 'meta_form' and (
      v_journey.page_id is null
      or v_journey.form_id is null
      or v_rule.page_id is distinct from v_journey.page_id
      or coalesce(v_rule.excluded_form_ids, '[]'::jsonb) ? v_journey.form_id
      or (
        coalesce(v_rule.use_all_forms, false) = false
        and not (coalesce(v_rule.included_form_ids, '[]'::jsonb) ? v_journey.form_id)
      )
    ) then
      v_reason := 'meta_form_scope_mismatch';
    elsif v_journey.source = 'meta_form'
       and v_rule.distribution_type not in ('automation_agent','agent_plus_seller','specific_agents','round_robin') then
      v_reason := 'meta_rule_distribution_invalid';
    elsif v_journey.source = 'whatsapp_campaign' and v_rule.source <> 'whatsapp_campaign' then
      v_reason := 'campaign_rule_source_mismatch';
    elsif v_journey.source = 'whatsapp_campaign' and case
      when jsonb_typeof(v_rule.agent_ids) = 'array'
        then jsonb_array_length(v_rule.agent_ids) <> 1
      else true
    end then
      v_reason := 'campaign_rule_ambiguous';
    elsif v_journey.source = 'whatsapp_campaign'
       and v_rule.distribution_type <> 'automation_agent' then
      v_reason := 'campaign_rule_distribution_invalid';
    elsif v_journey.source not in ('whatsapp_direct', 'meta_form', 'whatsapp_campaign') then
      v_reason := 'journey_source_not_authorized';
    end if;
  end if;

  if v_reason is null and v_journey.source = 'whatsapp_campaign' then
    select * into v_campaign from public.whatsapp_campaigns where id = v_journey.campaign_id;
    if v_campaign.id is null
       or v_campaign.status not in ('scheduled', 'processing', 'paused', 'completed')
       or v_campaign.tenant_id is distinct from v_out.tenant_id
       or v_campaign.agent_id is distinct from v_out.agent_id
       or v_campaign.connection_id is distinct from v_out.connection_id
       or v_campaign.rule_id is distinct from v_rule.id
       or v_campaign.transport is distinct from v_rule.transport then
      v_reason := 'campaign_authorization_revoked';
    end if;
  end if;

  if v_reason is null then
    update public.agent_outbound_outbox set
      authorization_status = 'authorized', authorization_reason = 'allowed',
      authorized_at = now(), dispatch_started_at = now(), updated_at = now()
     where id = v_out.id;
    insert into public.agent_outbound_authorization_events (
      tenant_id,outbox_id,operation_key,remote_jid_hash,agent_id,journey_id,rule_id,
      channel,connection_id,automation_epoch,decision,reason
    ) values (
      v_out.tenant_id,v_out.id,v_out.operation_key,md5(v_out.remote_jid),v_out.agent_id,
      v_out.journey_id,v_rule.id,v_out.channel,v_out.connection_id,
      p_expected_epoch,'authorized','allowed'
    );
    return jsonb_build_object('ok', true, 'reason', 'allowed', 'automation_epoch', p_expected_epoch);
  end if;

  update public.agent_outbound_outbox set
    status = 'cancelled', authorization_status = 'blocked', authorization_reason = v_reason,
    last_error = v_reason, claim_token = null, claim_expires_at = null, updated_at = now()
   where id = v_out.id;
  if v_reason in ('conversation_human_control', 'automation_epoch_stale')
     and v_out.job_id is not null
     and exists (
       select 1 from public.agent_agenda_pending_actions a
        where a.source_job_id = v_out.job_id and a.state = 'executed'
     ) then
    insert into public.conversation_events (
      tenant_id, remote_jid, lead_id, conversation_state_id, event_type,
      title, detail, actor_type
    ) values (
      v_out.tenant_id, v_out.remote_jid, v_out.lead_id, v_state.id,
      'agenda_preserved_after_transfer',
      'Agendamento concluído pela IA antes da transferência',
      'A mensagem automática posterior foi bloqueada; o compromisso confirmado foi preservado.',
      'system'
    );
  end if;
  insert into public.agent_outbound_authorization_events (
    tenant_id,outbox_id,operation_key,remote_jid_hash,agent_id,journey_id,rule_id,
    channel,connection_id,automation_epoch,decision,reason
  ) values (
    v_out.tenant_id,v_out.id,v_out.operation_key,md5(v_out.remote_jid),v_out.agent_id,
    v_out.journey_id,v_journey.rule_id,v_out.channel,v_out.connection_id,
    p_expected_epoch,'blocked',v_reason
  );
  return jsonb_build_object('ok', false, 'reason', v_reason);
end;
$$;

revoke all on function public.authorize_agent_outbound_dispatch_v3(uuid,uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.authorize_agent_outbound_dispatch_v3(uuid,uuid,bigint)
  to service_role;

-- Close dirty expired state without triggering jobs or messages.
create or replace function public.reconcile_agent_runtime_state_v1(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_closed integer := 0;
  v_cancelled_followups integer := 0;
begin
  with expired as (
    select id from public.lead_journeys
     where status = 'active' and expires_at is not null and expires_at <= now()
     order by expires_at asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 500), 2000))
  )
  update public.lead_journeys j
     set status = 'closed', ended_at = coalesce(ended_at, now()), updated_at = now()
    from expired
   where j.id = expired.id;
  get diagnostics v_closed = row_count;

  update public.follow_up_jobs f
     set status = 'cancelled', last_error = 'runtime_authorization_invalid',
         claim_token = null, claimed_at = null, claim_expires_at = null,
         heartbeat_at = null, updated_at = now()
   where f.status in ('pending', 'processing')
     and not exists (
       select 1
         from public.lead_journeys j
         join public.lead_distribution_rules r on r.id = j.rule_id
         join public.conversation_states s
           on s.tenant_id = j.tenant_id
          and s.remote_jid = j.remote_jid
          and s.channel = 'whatsapp'
        where j.id = f.journey_id
          and j.tenant_id = f.tenant_id
          and j.agent_id = f.agent_id
          and j.remote_jid = f.remote_jid
          and j.rule_id = f.rule_id
          and j.connection_id = f.connection_id
          and j.status = 'active'
          and j.expires_at is not null and j.expires_at > now()
          and r.tenant_id = f.tenant_id
          and r.active
          and r.connection_id = f.connection_id
          and coalesce(r.agent_ids, '[]'::jsonb) ? f.agent_id
          and (
            (f.channel = 'evolution' and r.transport = 'evolution') or
            (f.channel = 'meta_cloud' and r.transport in ('cloud_api', 'meta_cloud'))
          )
          and s.active_journey_id = j.id
          and s.conversation_mode = 'automation'
          and not coalesce(s.human_paused, false)
          and s.automation_epoch = f.automation_epoch
     );
  get diagnostics v_cancelled_followups = row_count;

  return jsonb_build_object(
    'closedJourneys', v_closed,
    'cancelledFollowUps', v_cancelled_followups
  );
end;
$$;

revoke all on function public.reconcile_agent_runtime_state_v1(integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_agent_runtime_state_v1(integer)
  to service_role;

-- Provider receipt + inbox bubble + response sequence are committed together.
-- This removes the interval in which an Evolution echo could be mistaken for
-- a message typed by a human and take over the conversation.
alter table public.whatsapp_messages
  add column if not exists agent_outbox_id uuid null
    references public.agent_outbound_outbox(id) on delete set null;

create unique index if not exists whatsapp_messages_agent_outbox_uidx
  on public.whatsapp_messages (tenant_id, agent_outbox_id)
  where agent_outbox_id is not null;

create or replace function public.finalize_agent_outbound_delivery_v1(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_kind text,
  p_content text,
  p_provider_remote_jid text,
  p_provider_status text,
  p_delivery_status text,
  p_media_url text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_out public.agent_outbound_outbox%rowtype;
  v_provider_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_message_id text;
  v_message_row_id uuid;
begin
  select * into v_out
    from public.agent_outbound_outbox
   where id = p_outbox_id
   for update;

  if v_out.id is null then
    return jsonb_build_object('ok', false, 'reason', 'outbox_missing');
  end if;
  if p_kind not in ('text', 'audio', 'image', 'video', 'document') then
    return jsonb_build_object('ok', false, 'reason', 'message_kind_invalid');
  end if;
  if v_out.status in ('sent', 'delivered') then
    if v_provider_id is not null
       and v_out.provider_message_id is not null
       and v_out.provider_message_id is distinct from v_provider_id then
      return jsonb_build_object('ok', false, 'reason', 'provider_receipt_mismatch');
    end if;
  elsif v_out.status <> 'processing'
     or v_out.claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok', false, 'reason', 'outbox_claim_invalid');
  end if;

  v_message_id := coalesce(v_provider_id, 'agent-outbox:' || v_out.id::text);

  -- If the provider echo won the race, convert that exact receipt into the
  -- audited automatic bubble instead of inserting a second row.
  if v_provider_id is not null then
    update public.whatsapp_messages
       set direction = 'outbound',
           kind = p_kind,
           content = left(coalesce(p_content, ''), 4000),
           message_id = v_provider_id,
           provider_message_id = v_provider_id,
           provider_remote_jid = p_provider_remote_jid,
           provider_status = p_provider_status,
           delivery_status = coalesce(nullif(p_delivery_status, ''), 'sent'),
           media_url = p_media_url,
           agent_id = v_out.agent_id,
           lead_id = v_out.lead_id,
           journey_id = v_out.journey_id,
           channel = v_out.channel,
           connection_id = v_out.connection_id,
           agent_outbox_id = v_out.id
     where tenant_id = v_out.tenant_id
       and connection_id is not distinct from v_out.connection_id
       and (provider_message_id = v_provider_id or message_id = v_provider_id)
     returning id into v_message_row_id;
  end if;

  if v_message_row_id is null then
    insert into public.whatsapp_messages (
      tenant_id, remote_jid, direction, kind, content, message_id,
      provider_message_id, provider_remote_jid, provider_status, delivery_status,
      media_url, agent_id, lead_id, journey_id, channel, connection_id,
      agent_outbox_id
    ) values (
      v_out.tenant_id, v_out.remote_jid, 'outbound', p_kind,
      left(coalesce(p_content, ''), 4000), v_message_id,
      v_provider_id, p_provider_remote_jid, p_provider_status,
      coalesce(nullif(p_delivery_status, ''), 'sent'), p_media_url,
      v_out.agent_id, v_out.lead_id, v_out.journey_id, v_out.channel,
      v_out.connection_id, v_out.id
    )
    on conflict (tenant_id, agent_outbox_id)
      where agent_outbox_id is not null
    do update set
      provider_message_id = coalesce(excluded.provider_message_id, public.whatsapp_messages.provider_message_id),
      provider_remote_jid = coalesce(excluded.provider_remote_jid, public.whatsapp_messages.provider_remote_jid),
      provider_status = coalesce(excluded.provider_status, public.whatsapp_messages.provider_status),
      delivery_status = excluded.delivery_status,
      media_url = coalesce(excluded.media_url, public.whatsapp_messages.media_url),
      content = excluded.content,
      agent_id = excluded.agent_id,
      lead_id = excluded.lead_id,
      journey_id = excluded.journey_id
    returning id into v_message_row_id;
  end if;

  update public.agent_outbound_outbox
     set status = 'sent',
         provider_message_id = coalesce(v_provider_id, provider_message_id),
         sent_at = coalesce(sent_at, now()),
         claim_token = null,
         claim_expires_at = null,
         last_error = null,
         updated_at = now()
   where id = v_out.id;

  if coalesce(v_out.conversation_sequence, 0) > 0 then
    update public.conversation_states
       set last_agent_response_at = now(),
           last_agent_response_sequence = v_out.conversation_sequence,
           updated_at = now()
     where tenant_id = v_out.tenant_id
       and remote_jid = v_out.remote_jid
       and channel = 'whatsapp'
       and agent_turn_sequence = v_out.conversation_sequence;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'sent',
    'outboxId', v_out.id,
    'messageId', v_message_row_id,
    'providerMessageId', v_provider_id
  );
end;
$$;

revoke all on function public.finalize_agent_outbound_delivery_v1(
  uuid,uuid,text,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.finalize_agent_outbound_delivery_v1(
  uuid,uuid,text,text,text,text,text,text,text
) to service_role;
