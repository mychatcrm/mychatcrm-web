-- Omnichannel authorization v2: fail-closed dispatch, human-control epoch,
-- expiring journeys and agenda mutations guarded by the same conversation lock.

ALTER TABLE public.conversation_states
  ADD COLUMN IF NOT EXISTS automation_epoch bigint NOT NULL DEFAULT 0;

ALTER TABLE public.lead_journeys
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

UPDATE public.lead_journeys j
   SET expires_at = j.last_activity_at
     + make_interval(mins => COALESCE(r.conflict_inactivity_minutes, 1440))
  FROM public.lead_distribution_rules r
 WHERE r.id = j.rule_id
   AND j.expires_at IS NULL;

UPDATE public.lead_journeys
   SET expires_at = last_activity_at + interval '24 hours'
 WHERE expires_at IS NULL;

UPDATE public.lead_journeys
   SET status = 'manual_review', ended_at = COALESCE(ended_at, now()), updated_at = now()
 WHERE status = 'active' AND connection_id IS NULL;

UPDATE public.lead_distribution_rules
   SET active = false, updated_at = now()
 WHERE source = 'whatsapp_organico'
   AND active = true
   AND (
     connection_id IS NULL
     OR jsonb_typeof(agent_ids) <> 'array'
     OR jsonb_array_length(agent_ids) <> 1
   );

ALTER TABLE public.agent_outbound_outbox
  ALTER COLUMN job_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS operation_key text NULL,
  ADD COLUMN IF NOT EXISTS rule_id uuid NULL,
  ADD COLUMN IF NOT EXISTS automation_epoch bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS authorization_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS authorization_reason text NULL,
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz NULL;

UPDATE public.agent_outbound_outbox
   SET operation_key = 'legacy-job:' || job_id::text || ':' || burst_generation::text || ':' || kind
 WHERE operation_key IS NULL;
ALTER TABLE public.agent_outbound_outbox ALTER COLUMN operation_key SET NOT NULL;

ALTER TABLE public.agent_outbound_outbox
  DROP CONSTRAINT IF EXISTS agent_outbound_outbox_kind_check;
ALTER TABLE public.agent_outbound_outbox
  ADD CONSTRAINT agent_outbound_outbox_kind_check
  CHECK (kind IN ('text', 'audio', 'image', 'video', 'document', 'template'));

DROP INDEX IF EXISTS public.agent_outbound_outbox_operation_key_uidx;
CREATE UNIQUE INDEX agent_outbound_outbox_operation_key_uidx
  ON public.agent_outbound_outbox (tenant_id, operation_key);
CREATE INDEX IF NOT EXISTS conversation_states_automation_epoch_idx
  ON public.conversation_states (tenant_id, remote_jid, automation_epoch);
CREATE INDEX IF NOT EXISTS lead_journeys_active_expiry_idx
  ON public.lead_journeys (tenant_id, remote_jid, expires_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.agent_outbound_authorization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  outbox_id uuid NULL REFERENCES public.agent_outbound_outbox(id) ON DELETE SET NULL,
  operation_key text NULL,
  remote_jid_hash text NOT NULL,
  agent_id text NULL,
  journey_id uuid NULL,
  rule_id uuid NULL,
  channel text NULL,
  connection_id text NULL,
  automation_epoch bigint NULL,
  decision text NOT NULL CHECK (decision IN ('authorized', 'blocked')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_outbound_auth_events_tenant_created_idx
  ON public.agent_outbound_authorization_events (tenant_id, created_at DESC);
ALTER TABLE public.agent_outbound_authorization_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_outbound_authorization_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.agent_outbound_authorization_events TO service_role;

CREATE OR REPLACE FUNCTION public.set_conversation_operation_v2(
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
  p_transfer_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_state public.conversation_states%ROWTYPE;
BEGIN
  IF p_mode NOT IN ('automation', 'waiting_human', 'human') THEN
    RAISE EXCEPTION 'invalid_conversation_mode';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agent-conversation:' || p_tenant_id || ':' || p_remote_jid, 0
  ));
  INSERT INTO public.conversation_states (
    tenant_id, remote_jid, channel, lead_id, agent_id, conversation_mode,
    human_paused, paused_reason, paused_by, handoff_suggested, handoff_reason,
    assigned_human_id, assigned_human_name, transferred_from, transferred_to,
    transfer_reason, status, paused_at, resumed_at, automation_epoch, updated_at
  ) VALUES (
    p_tenant_id, p_remote_jid, 'whatsapp', p_lead_id, p_agent_id, p_mode,
    p_human_paused, p_paused_reason, p_paused_by, p_handoff_suggested,
    p_handoff_reason, p_assigned_human_id, p_assigned_human_name,
    p_transferred_from, p_transferred_to, p_transfer_reason,
    CASE WHEN p_human_paused THEN 'human_paused' ELSE 'active' END,
    CASE WHEN p_human_paused THEN now() ELSE NULL END,
    CASE WHEN p_human_paused THEN NULL ELSE now() END, 1, now()
  )
  ON CONFLICT (tenant_id, remote_jid, channel) DO UPDATE SET
    lead_id = COALESCE(EXCLUDED.lead_id, conversation_states.lead_id),
    agent_id = COALESCE(EXCLUDED.agent_id, conversation_states.agent_id),
    conversation_mode = EXCLUDED.conversation_mode,
    human_paused = EXCLUDED.human_paused,
    paused_reason = EXCLUDED.paused_reason,
    paused_by = EXCLUDED.paused_by,
    handoff_suggested = EXCLUDED.handoff_suggested,
    handoff_reason = EXCLUDED.handoff_reason,
    assigned_human_id = EXCLUDED.assigned_human_id,
    assigned_human_name = EXCLUDED.assigned_human_name,
    transferred_from = EXCLUDED.transferred_from,
    transferred_to = EXCLUDED.transferred_to,
    transfer_reason = EXCLUDED.transfer_reason,
    status = EXCLUDED.status,
    paused_at = CASE WHEN EXCLUDED.human_paused THEN now() ELSE conversation_states.paused_at END,
    resumed_at = CASE WHEN EXCLUDED.human_paused THEN conversation_states.resumed_at ELSE now() END,
    automation_epoch = conversation_states.automation_epoch + 1,
    updated_at = now()
  RETURNING * INTO v_state;

  IF p_mode <> 'automation' OR p_human_paused THEN
    UPDATE public.agent_response_jobs
       SET status = 'cancelled', failed_reason = COALESCE(p_paused_reason, 'human_control'),
           claim_token = NULL, claim_expires_at = NULL, locked_at = NULL,
           completed_at = now(), updated_at = now()
     WHERE tenant_id = p_tenant_id AND remote_jid = p_remote_jid
       AND status IN ('pending', 'processing');
    UPDATE public.agent_outbound_outbox
       SET status = 'cancelled', authorization_status = 'blocked',
           authorization_reason = COALESCE(p_paused_reason, 'human_control'),
           claim_token = NULL, claim_expires_at = NULL, updated_at = now()
     WHERE tenant_id = p_tenant_id AND remote_jid = p_remote_jid
       AND status IN ('pending', 'processing', 'failed');
    UPDATE public.follow_up_jobs
       SET status = 'cancelled', last_error = COALESCE(p_paused_reason, 'human_control'), updated_at = now()
     WHERE tenant_id = p_tenant_id AND remote_jid = p_remote_jid AND status = 'pending';
    UPDATE public.agent_agenda_pending_actions
       SET state = 'rejected', updated_at = now()
     WHERE tenant_id = p_tenant_id AND remote_jid = p_remote_jid AND state = 'pending';
  END IF;
  RETURN to_jsonb(v_state);
END;
$$;
REVOKE ALL ON FUNCTION public.set_conversation_operation_v2(
  text,text,uuid,text,text,boolean,text,text,boolean,text,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_operation_v2(
  text,text,uuid,text,text,boolean,text,text,boolean,text,text,text,text,text,text
) TO service_role;

CREATE OR REPLACE FUNCTION public.bind_active_journey_v2(
  p_tenant_id text, p_remote_jid text, p_journey_id uuid, p_lead_id uuid,
  p_agent_id text, p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_journey public.lead_journeys%ROWTYPE;
  v_state public.conversation_states%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agent-conversation:' || p_tenant_id || ':' || p_remote_jid, 0
  ));
  SELECT * INTO v_journey FROM public.lead_journeys
   WHERE id = p_journey_id AND tenant_id = p_tenant_id AND remote_jid = p_remote_jid
   FOR UPDATE;
  IF v_journey.id IS NULL OR v_journey.status <> 'active'
     OR v_journey.connection_id IS NULL OR v_journey.agent_id IS NULL THEN
    RAISE EXCEPTION 'journey_not_bindable';
  END IF;
  UPDATE public.lead_journeys SET expires_at = p_expires_at, updated_at = now()
   WHERE id = p_journey_id;
  INSERT INTO public.conversation_states (
    tenant_id, remote_jid, channel, lead_id, agent_id, active_journey_id,
    automation_epoch, updated_at
  ) VALUES (
    p_tenant_id, p_remote_jid, 'whatsapp', p_lead_id, p_agent_id,
    p_journey_id, 1, now()
  ) ON CONFLICT (tenant_id, remote_jid, channel) DO UPDATE SET
    lead_id = COALESCE(EXCLUDED.lead_id, conversation_states.lead_id),
    agent_id = EXCLUDED.agent_id,
    active_journey_id = EXCLUDED.active_journey_id,
    automation_epoch = CASE
      WHEN conversation_states.active_journey_id IS DISTINCT FROM EXCLUDED.active_journey_id
        OR conversation_states.agent_id IS DISTINCT FROM EXCLUDED.agent_id
      THEN conversation_states.automation_epoch + 1
      ELSE conversation_states.automation_epoch
    END,
    updated_at = now()
  RETURNING * INTO v_state;
  RETURN to_jsonb(v_state);
END;
$$;
REVOKE ALL ON FUNCTION public.bind_active_journey_v2(text,text,uuid,uuid,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_active_journey_v2(text,text,uuid,uuid,text,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_agent_outbound_dispatch_v2(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_expected_epoch bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_out public.agent_outbound_outbox%ROWTYPE;
  v_state public.conversation_states%ROWTYPE;
  v_journey public.lead_journeys%ROWTYPE;
  v_rule public.lead_distribution_rules%ROWTYPE;
  v_campaign public.whatsapp_campaigns%ROWTYPE;
  v_reason text := NULL;
BEGIN
  SELECT * INTO v_out FROM public.agent_outbound_outbox WHERE id = p_outbox_id;
  IF v_out.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'outbox_missing'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agent-conversation:' || v_out.tenant_id || ':' || v_out.remote_jid, 0
  ));
  SELECT * INTO v_out FROM public.agent_outbound_outbox WHERE id = p_outbox_id FOR UPDATE;
  SELECT * INTO v_state FROM public.conversation_states
   WHERE tenant_id = v_out.tenant_id AND remote_jid = v_out.remote_jid AND channel = 'whatsapp'
   FOR UPDATE;

  IF v_out.status <> 'processing' OR v_out.claim_token IS DISTINCT FROM p_claim_token THEN
    v_reason := 'outbox_claim_invalid';
  ELSIF v_state.id IS NULL THEN v_reason := 'conversation_state_missing';
  ELSIF v_state.conversation_mode IS DISTINCT FROM 'automation' OR v_state.human_paused THEN
    v_reason := 'conversation_human_control';
  ELSIF v_state.automation_epoch IS DISTINCT FROM p_expected_epoch
     OR v_out.automation_epoch IS DISTINCT FROM p_expected_epoch THEN
    v_reason := 'automation_epoch_stale';
  ELSIF v_out.journey_id IS NULL THEN v_reason := 'journey_missing';
  ELSIF v_out.connection_id IS NULL THEN v_reason := 'connection_missing';
  END IF;

  IF v_reason IS NULL THEN
    SELECT * INTO v_journey FROM public.lead_journeys WHERE id = v_out.journey_id FOR UPDATE;
    IF v_journey.id IS NULL OR v_journey.status <> 'active' THEN v_reason := 'journey_not_active';
    ELSIF v_journey.expires_at IS NULL OR v_journey.expires_at <= now() THEN v_reason := 'journey_expired';
    ELSIF v_journey.tenant_id IS DISTINCT FROM v_out.tenant_id
       OR v_journey.remote_jid IS DISTINCT FROM v_out.remote_jid
       OR v_journey.agent_id IS DISTINCT FROM v_out.agent_id THEN v_reason := 'journey_owner_mismatch';
    ELSIF v_journey.connection_id IS NULL
       OR v_journey.connection_id IS DISTINCT FROM v_out.connection_id THEN v_reason := 'journey_connection_mismatch';
    END IF;
  END IF;

  IF v_reason IS NULL AND v_journey.source = 'whatsapp_campaign' THEN
    SELECT * INTO v_campaign FROM public.whatsapp_campaigns WHERE id = v_journey.campaign_id;
    IF v_campaign.id IS NULL OR v_campaign.status IN ('cancelled', 'failed')
       OR v_campaign.agent_id IS DISTINCT FROM v_out.agent_id
       OR v_campaign.connection_id IS DISTINCT FROM v_out.connection_id THEN
      v_reason := 'campaign_authorization_revoked';
    END IF;
  ELSIF v_reason IS NULL THEN
    SELECT * INTO v_rule FROM public.lead_distribution_rules WHERE id = v_journey.rule_id;
    IF v_rule.id IS NULL OR NOT v_rule.active THEN v_reason := 'rule_inactive';
    ELSIF v_rule.tenant_id IS DISTINCT FROM v_out.tenant_id
       OR v_rule.connection_id IS NULL
       OR v_rule.connection_id IS DISTINCT FROM v_out.connection_id
       OR NOT (COALESCE(v_rule.agent_ids, '[]'::jsonb) ? v_out.agent_id) THEN
      v_reason := 'rule_scope_mismatch';
    ELSIF v_journey.source = 'whatsapp_direct' AND v_rule.source <> 'whatsapp_organico' THEN
      v_reason := 'direct_rule_source_mismatch';
    ELSIF v_journey.source IN ('meta_form', 'manual') AND v_rule.source <> 'meta_form' THEN
      v_reason := 'meta_rule_source_mismatch';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    UPDATE public.agent_outbound_outbox SET
      rule_id = v_journey.rule_id, authorization_status = 'authorized',
      authorization_reason = 'allowed', authorized_at = now(), dispatch_started_at = now(),
      updated_at = now()
    WHERE id = v_out.id;
    INSERT INTO public.agent_outbound_authorization_events (
      tenant_id,outbox_id,operation_key,remote_jid_hash,agent_id,journey_id,rule_id,
      channel,connection_id,automation_epoch,decision,reason
    ) VALUES (
      v_out.tenant_id,v_out.id,v_out.operation_key,md5(v_out.remote_jid),v_out.agent_id,
      v_out.journey_id,v_journey.rule_id,v_out.channel,v_out.connection_id,
      p_expected_epoch,'authorized','allowed'
    );
    RETURN jsonb_build_object('ok', true, 'reason', 'allowed', 'automation_epoch', p_expected_epoch);
  END IF;

  UPDATE public.agent_outbound_outbox SET
    status = 'cancelled', authorization_status = 'blocked', authorization_reason = v_reason,
    last_error = v_reason, claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = v_out.id;
  IF v_reason IN ('conversation_human_control', 'automation_epoch_stale')
     AND v_out.job_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.agent_agenda_pending_actions a
        WHERE a.source_job_id = v_out.job_id AND a.state = 'executed'
     ) THEN
    INSERT INTO public.conversation_events (
      tenant_id, remote_jid, lead_id, conversation_state_id, event_type,
      title, detail, actor_type
    ) VALUES (
      v_out.tenant_id, v_out.remote_jid, v_out.lead_id, v_state.id,
      'agenda_preserved_after_transfer',
      'Agendamento concluído pela IA antes da transferência',
      'A mensagem automática posterior foi bloqueada; o compromisso confirmado foi preservado.',
      'system'
    );
  END IF;
  INSERT INTO public.agent_outbound_authorization_events (
    tenant_id,outbox_id,operation_key,remote_jid_hash,agent_id,journey_id,rule_id,
    channel,connection_id,automation_epoch,decision,reason
  ) VALUES (
    v_out.tenant_id,v_out.id,v_out.operation_key,md5(v_out.remote_jid),v_out.agent_id,
    v_out.journey_id,v_journey.rule_id,v_out.channel,v_out.connection_id,
    p_expected_epoch,'blocked',v_reason
  );
  RETURN jsonb_build_object('ok', false, 'reason', v_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_agent_outbound_dispatch_v2(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_agent_outbound_dispatch_v2(uuid,uuid,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_agent_agenda_mutation_guarded(
  p_tenant_id text, p_operation_key text, p_action text, p_attendee_phone text,
  p_event_id uuid, p_title text, p_description text, p_location text,
  p_start_at timestamptz, p_end_at timestamptz, p_attendee_name text,
  p_lead_id uuid, p_agent_id text, p_allow_simultaneous boolean, p_job_id uuid,
  p_claimed_generation integer, p_journey_id uuid, p_conversation_sequence bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_job public.agent_response_jobs%ROWTYPE;
  v_state public.conversation_states%ROWTYPE;
  v_journey public.lead_journeys%ROWTYPE;
  v_remote_jid text;
  v_result jsonb;
BEGIN
  IF p_job_id IS NULL OR p_claimed_generation IS NULL OR p_conversation_sequence IS NULL THEN
    RAISE EXCEPTION 'invalid_job_params';
  END IF;
  SELECT remote_jid INTO v_remote_jid FROM public.agent_response_jobs WHERE id = p_job_id;
  IF v_remote_jid IS NULL THEN RAISE EXCEPTION 'generation_stale'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agent-conversation:' || p_tenant_id || ':' || v_remote_jid, 0
  ));
  SELECT * INTO v_job FROM public.agent_response_jobs WHERE id = p_job_id FOR UPDATE;
  SELECT * INTO v_state FROM public.conversation_states
   WHERE tenant_id = p_tenant_id AND remote_jid = v_job.remote_jid AND channel = 'whatsapp' FOR UPDATE;
  SELECT * INTO v_journey FROM public.lead_journeys WHERE id = p_journey_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.tenant_id IS DISTINCT FROM p_tenant_id
     OR regexp_replace(split_part(v_job.remote_jid, '@', 1), '[^0-9]', '', 'g') IS DISTINCT FROM p_attendee_phone
     OR v_job.conversation_sequence IS DISTINCT FROM p_conversation_sequence
     OR v_job.burst_generation IS DISTINCT FROM p_claimed_generation
     OR v_job.status = 'cancelled'
     OR v_state.agent_turn_sequence IS DISTINCT FROM p_conversation_sequence
     OR v_state.conversation_mode IS DISTINCT FROM 'automation'
     OR v_state.human_paused
     OR v_journey.id IS NULL OR v_journey.status <> 'active'
     OR v_journey.expires_at IS NULL OR v_journey.expires_at <= now()
     OR v_journey.agent_id IS DISTINCT FROM p_agent_id
     OR v_journey.remote_jid IS DISTINCT FROM v_job.remote_jid THEN
    RAISE EXCEPTION 'generation_stale';
  END IF;
  SELECT public.apply_agent_agenda_mutation(
    p_tenant_id,p_operation_key,p_action,p_attendee_phone,p_event_id,p_title,
    p_description,p_location,p_start_at,p_end_at,p_attendee_name,p_lead_id,
    p_agent_id,p_allow_simultaneous,p_job_id,p_claimed_generation,p_journey_id
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_agent_agenda_mutation_guarded(
  text,text,text,text,uuid,text,text,text,timestamptz,timestamptz,text,uuid,text,
  boolean,uuid,integer,uuid,bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_agent_agenda_mutation_guarded(
  text,text,text,text,uuid,text,text,text,timestamptz,timestamptz,text,uuid,text,
  boolean,uuid,integer,uuid,bigint
) TO service_role;
