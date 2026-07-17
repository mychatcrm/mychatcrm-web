-- Conversation-wide turn ordering, trusted agenda reads and guarded mutations.
-- Additive/rollback-safe: the v2 scheduler and original agenda RPC remain intact.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS conversation_sequence bigint NULL,
  ADD COLUMN IF NOT EXISTS is_late_fragment boolean NOT NULL DEFAULT false;

ALTER TABLE public.conversation_states
  ADD COLUMN IF NOT EXISTS agent_turn_sequence bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_inbound_received_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_inbound_occurred_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_agent_response_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_agent_response_sequence bigint NULL;

ALTER TABLE public.agent_response_jobs
  ADD COLUMN IF NOT EXISTS conversation_sequence bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_first_message_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS provider_last_message_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_late_fragment boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_outbound_outbox
  ADD COLUMN IF NOT EXISTS conversation_sequence bigint NOT NULL DEFAULT 0;

ALTER TABLE public.agent_agenda_pending_actions
  ADD COLUMN IF NOT EXISTS conversation_sequence bigint NULL;

UPDATE public.agent_agenda_pending_actions
   SET state = 'rejected'
 WHERE state = 'cancelled';
UPDATE public.agent_agenda_pending_actions
   SET state = 'superseded'
 WHERE state = 'confirmed';

ALTER TABLE public.agent_agenda_pending_actions
  DROP CONSTRAINT IF EXISTS agent_agenda_pending_actions_state_check;
ALTER TABLE public.agent_agenda_pending_actions
  ADD CONSTRAINT agent_agenda_pending_actions_state_check
  CHECK (state IN ('pending', 'executed', 'rejected', 'expired', 'superseded'));

CREATE INDEX IF NOT EXISTS whatsapp_messages_conversation_sequence_idx
  ON public.whatsapp_messages (tenant_id, remote_jid, conversation_sequence);
CREATE INDEX IF NOT EXISTS agent_response_jobs_conversation_sequence_idx
  ON public.agent_response_jobs (tenant_id, remote_jid, conversation_sequence);

CREATE OR REPLACE FUNCTION public.upsert_agent_response_job_burst_v3(
  p_tenant_id text,
  p_remote_jid text,
  p_agent_id text,
  p_instance_name text,
  p_channel text,
  p_connection_id text,
  p_message_id uuid,
  p_provider_occurred_at timestamptz,
  p_received_at timestamptz,
  p_initial_seconds integer,
  p_followup_seconds integer,
  p_max_seconds integer,
  p_lead_id uuid,
  p_journey_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job public.agent_response_jobs%ROWTYPE;
  v_state public.conversation_states%ROWTYPE;
  v_first_at timestamptz;
  v_last_at timestamptz;
  v_max_wait_until timestamptz;
  v_scheduled_for timestamptz;
  v_message_ids jsonb;
  v_provider_at timestamptz;
  v_late boolean;
BEGIN
  IF NULLIF(btrim(p_tenant_id), '') IS NULL
     OR NULLIF(btrim(p_remote_jid), '') IS NULL
     OR NULLIF(btrim(p_agent_id), '') IS NULL
     OR NULLIF(btrim(p_instance_name), '') IS NULL
     OR p_channel NOT IN ('evolution', 'meta_cloud')
     OR p_message_id IS NULL
     OR p_received_at IS NULL THEN
    RAISE EXCEPTION 'invalid_agent_response_job_params';
  END IF;
  IF p_initial_seconds < 0 OR p_followup_seconds < 0 OR p_max_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid_agent_response_wait_settings';
  END IF;

  v_provider_at := COALESCE(p_provider_occurred_at, p_received_at);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agent-conversation:' || p_tenant_id || ':' || p_remote_jid,
    0
  ));

  INSERT INTO public.conversation_states (
    tenant_id, remote_jid, lead_id, agent_id, channel, status,
    last_message_at, agent_turn_sequence, last_inbound_received_at,
    last_inbound_occurred_at, updated_at
  ) VALUES (
    p_tenant_id, p_remote_jid, p_lead_id, p_agent_id, 'whatsapp', 'active',
    v_provider_at, 1, p_received_at, v_provider_at, now()
  )
  ON CONFLICT (tenant_id, remote_jid, channel) DO UPDATE
    SET lead_id = COALESCE(EXCLUDED.lead_id, conversation_states.lead_id),
        agent_id = EXCLUDED.agent_id,
        status = 'active',
        last_message_at = GREATEST(conversation_states.last_message_at, EXCLUDED.last_message_at),
        agent_turn_sequence = conversation_states.agent_turn_sequence + 1,
        last_inbound_received_at = EXCLUDED.last_inbound_received_at,
        last_inbound_occurred_at = EXCLUDED.last_inbound_occurred_at,
        updated_at = now()
  RETURNING * INTO v_state;

  v_late := v_state.last_agent_response_at IS NOT NULL
    AND v_provider_at < v_state.last_agent_response_at
    AND p_received_at >= v_state.last_agent_response_at;

  UPDATE public.whatsapp_messages
     SET received_at = p_received_at,
         conversation_sequence = v_state.agent_turn_sequence,
         is_late_fragment = v_late
   WHERE id = p_message_id
     AND tenant_id = p_tenant_id
     AND remote_jid = p_remote_jid
     AND direction = 'inbound';

  UPDATE public.agent_outbound_outbox
     SET status = 'cancelled', claim_token = NULL, claim_expires_at = NULL,
         last_error = 'conversation_sequence_superseded', updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND remote_jid = p_remote_jid
     AND conversation_sequence > 0
     AND conversation_sequence < v_state.agent_turn_sequence
     AND status IN ('pending', 'processing', 'failed');

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agent-response:' || p_tenant_id || ':' || p_remote_jid || ':' ||
    p_channel || ':' || COALESCE(p_connection_id, ''),
    0
  ));

  SELECT * INTO v_job
    FROM public.agent_response_jobs
   WHERE tenant_id = p_tenant_id
     AND remote_jid = p_remote_jid
     AND channel = p_channel
     AND connection_id IS NOT DISTINCT FROM p_connection_id
     AND status IN ('pending', 'processing')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND AND v_job.journey_id IS DISTINCT FROM p_journey_id THEN
    UPDATE public.agent_response_jobs
       SET status = 'cancelled', failed_reason = 'journey_replaced',
           completed_at = now(), claim_token = NULL,
           claim_expires_at = NULL, locked_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    v_job.id := NULL;
  END IF;

  IF v_job.id IS NOT NULL THEN
    IF COALESCE(v_job.message_ids, '[]'::jsonb) @> jsonb_build_array(p_message_id::text) THEN
      RETURN to_jsonb(v_job);
    END IF;

    v_message_ids := COALESCE(v_job.message_ids, '[]'::jsonb)
      || jsonb_build_array(p_message_id::text);
    v_first_at := LEAST(v_job.first_message_at, p_received_at);
    v_last_at := GREATEST(v_job.last_message_at, p_received_at);
    v_max_wait_until := v_first_at + make_interval(secs => p_max_seconds);
    v_scheduled_for := LEAST(
      v_last_at + make_interval(secs => p_followup_seconds),
      v_max_wait_until
    );

    UPDATE public.agent_response_jobs
       SET lead_id = COALESCE(p_lead_id, lead_id),
           journey_id = p_journey_id,
           agent_id = p_agent_id,
           instance_name = p_instance_name,
           channel = p_channel,
           connection_id = p_connection_id,
           first_message_at = v_first_at,
           last_message_at = v_last_at,
           scheduled_for = v_scheduled_for,
           max_wait_until = v_max_wait_until,
           message_ids = v_message_ids,
           inbound_message_count = jsonb_array_length(v_message_ids),
           burst_generation = v_job.burst_generation + 1,
           conversation_sequence = v_state.agent_turn_sequence,
           provider_first_message_at = LEAST(COALESCE(v_job.provider_first_message_at, v_provider_at), v_provider_at),
           provider_last_message_at = GREATEST(COALESCE(v_job.provider_last_message_at, v_provider_at), v_provider_at),
           is_late_fragment = v_job.is_late_fragment AND v_late,
           completed_at = NULL,
           failed_reason = NULL,
           updated_at = now()
     WHERE id = v_job.id
     RETURNING * INTO v_job;
    RETURN to_jsonb(v_job);
  END IF;

  v_first_at := p_received_at;
  v_last_at := p_received_at;
  v_max_wait_until := p_received_at + make_interval(secs => p_max_seconds);
  v_scheduled_for := LEAST(
    p_received_at + make_interval(secs => p_initial_seconds),
    v_max_wait_until
  );

  INSERT INTO public.agent_response_jobs (
    tenant_id, lead_id, journey_id, remote_jid, agent_id, instance_name,
    channel, connection_id, status, first_message_at, last_message_at,
    scheduled_for, max_wait_until, message_ids, inbound_message_count,
    burst_generation, conversation_sequence, provider_first_message_at,
    provider_last_message_at, is_late_fragment
  ) VALUES (
    p_tenant_id, p_lead_id, p_journey_id, p_remote_jid, p_agent_id,
    p_instance_name, p_channel, p_connection_id, 'pending', v_first_at,
    v_last_at, v_scheduled_for, v_max_wait_until,
    jsonb_build_array(p_message_id::text), 1, 1, v_state.agent_turn_sequence,
    v_provider_at, v_provider_at, v_late
  ) RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_agent_response_job_burst_v3(
  text, text, text, text, text, text, uuid, timestamptz, timestamptz,
  integer, integer, integer, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_agent_response_job_burst_v3(
  text, text, text, text, text, text, uuid, timestamptz, timestamptz,
  integer, integer, integer, uuid, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.is_agent_conversation_sequence_current(
  p_tenant_id text,
  p_remote_jid text,
  p_sequence bigint
) RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_states
     WHERE tenant_id = p_tenant_id
       AND remote_jid = p_remote_jid
       AND channel = 'whatsapp'
       AND agent_turn_sequence = p_sequence
  );
$$;

REVOKE ALL ON FUNCTION public.is_agent_conversation_sequence_current(text, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_agent_conversation_sequence_current(text, text, bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_agent_conversation_response(
  p_tenant_id text,
  p_remote_jid text,
  p_sequence bigint,
  p_responded_at timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.conversation_states
     SET last_agent_response_at = p_responded_at,
         last_agent_response_sequence = p_sequence,
         updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND remote_jid = p_remote_jid
     AND channel = 'whatsapp'
     AND agent_turn_sequence = p_sequence;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_agent_conversation_response(text, text, bigint, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_agent_conversation_response(text, text, bigint, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_contact_agenda(
  p_tenant_id text,
  p_attendee_phone text,
  p_include_history boolean DEFAULT false,
  p_limit integer DEFAULT 5
) RETURNS TABLE (
  id uuid,
  title text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  location text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text;
BEGIN
  v_phone := regexp_replace(COALESCE(p_attendee_phone, ''), '[^0-9]', '', 'g');
  IF NULLIF(btrim(p_tenant_id), '') IS NULL OR length(v_phone) < 8 OR length(v_phone) > 15 THEN
    RAISE EXCEPTION 'invalid_contact_agenda_identity';
  END IF;
  RETURN QUERY
  SELECT event.id, event.title, event.start_at, event.end_at, event.status, event.location
    FROM public.agenda_events AS event
   WHERE event.tenant_id = p_tenant_id
     AND event.attendee_phone = v_phone
     AND event.status <> 'cancelled'
     AND (p_include_history OR event.start_at >= now())
   ORDER BY event.start_at ASC
   LIMIT greatest(1, least(COALESCE(p_limit, 5), 20));
END;
$$;

REVOKE ALL ON FUNCTION public.list_contact_agenda(text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_contact_agenda(text, text, boolean, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_agent_agenda_mutation_guarded(
  p_tenant_id text,
  p_operation_key text,
  p_action text,
  p_attendee_phone text,
  p_event_id uuid,
  p_title text,
  p_description text,
  p_location text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_attendee_name text,
  p_lead_id uuid,
  p_agent_id text,
  p_allow_simultaneous boolean,
  p_job_id uuid,
  p_claimed_generation integer,
  p_journey_id uuid,
  p_conversation_sequence bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job public.agent_response_jobs%ROWTYPE;
  v_current_sequence bigint;
  v_remote_jid text;
  v_result jsonb;
BEGIN
  IF p_job_id IS NULL OR p_claimed_generation IS NULL OR p_conversation_sequence IS NULL THEN
    RAISE EXCEPTION 'invalid_job_params';
  END IF;

  SELECT remote_jid INTO v_remote_jid
    FROM public.agent_response_jobs
   WHERE id = p_job_id;
  IF v_remote_jid IS NULL THEN
    RAISE EXCEPTION 'generation_stale';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agent-conversation:' || p_tenant_id || ':' || v_remote_jid,
    0
  ));

  SELECT * INTO v_job
    FROM public.agent_response_jobs
   WHERE id = p_job_id
   FOR UPDATE;
  SELECT agent_turn_sequence INTO v_current_sequence
    FROM public.conversation_states
   WHERE tenant_id = p_tenant_id
     AND remote_jid = v_job.remote_jid
     AND channel = 'whatsapp'
   FOR UPDATE;

  IF v_job.id IS NULL
     OR v_job.tenant_id IS DISTINCT FROM p_tenant_id
     OR regexp_replace(split_part(v_job.remote_jid, '@', 1), '[^0-9]', '', 'g') IS DISTINCT FROM p_attendee_phone
     OR v_job.conversation_sequence IS DISTINCT FROM p_conversation_sequence
     OR v_job.burst_generation IS DISTINCT FROM p_claimed_generation
     OR v_job.status = 'cancelled'
     OR v_current_sequence IS DISTINCT FROM p_conversation_sequence THEN
    RAISE EXCEPTION 'generation_stale';
  END IF;

  SELECT public.apply_agent_agenda_mutation(
    p_tenant_id, p_operation_key, p_action, p_attendee_phone, p_event_id,
    p_title, p_description, p_location, p_start_at, p_end_at,
    p_attendee_name, p_lead_id, p_agent_id, p_allow_simultaneous,
    p_job_id, p_claimed_generation, p_journey_id
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_agent_agenda_mutation_guarded(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean, uuid, integer, uuid, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_agent_agenda_mutation_guarded(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean, uuid, integer, uuid, bigint
) TO service_role;
