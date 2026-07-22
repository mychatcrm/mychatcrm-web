-- One durable, consolidated response per omnichannel inbound burst.
-- Additive and rollback-safe: v3 remains available for the previous runtime.

CREATE OR REPLACE FUNCTION public.upsert_agent_response_job_burst_v4(
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
     OR NULLIF(btrim(p_connection_id), '') IS NULL
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

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'agent-response:' || p_tenant_id || ':' || p_remote_jid || ':' ||
    p_channel || ':' || p_connection_id,
    0
  ));

  SELECT * INTO v_job
    FROM public.agent_response_jobs
   WHERE tenant_id = p_tenant_id
     AND remote_jid = p_remote_jid
     AND channel = p_channel
     AND connection_id = p_connection_id
     AND status IN ('pending', 'processing')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  -- Provider retries are true no-ops: do not advance the conversation sequence,
  -- generation or schedule, and do not revoke an outbound already authorized.
  IF FOUND AND COALESCE(v_job.message_ids, '[]'::jsonb) @> jsonb_build_array(p_message_id::text) THEN
    RETURN to_jsonb(v_job);
  END IF;

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

  IF v_job.id IS NOT NULL AND (
    v_job.journey_id IS DISTINCT FROM p_journey_id
    OR v_job.agent_id IS DISTINCT FROM p_agent_id
    OR v_job.instance_name IS DISTINCT FROM p_instance_name
  ) THEN
    UPDATE public.agent_response_jobs
       SET status = 'cancelled', failed_reason = 'response_owner_replaced',
           completed_at = now(), claim_token = NULL,
           claim_expires_at = NULL, locked_at = NULL, updated_at = now()
     WHERE id = v_job.id;
    v_job.id := NULL;
  END IF;

  IF v_job.id IS NOT NULL THEN
    v_message_ids := COALESCE(v_job.message_ids, '[]'::jsonb)
      || jsonb_build_array(p_message_id::text);
    v_first_at := LEAST(v_job.first_message_at, p_received_at);
    v_last_at := GREATEST(v_job.last_message_at, p_received_at);
    IF p_channel = 'evolution' THEN
      -- Sliding silence: every Evolution fragment restarts the transport guard.
      v_scheduled_for := v_last_at + make_interval(secs => GREATEST(p_followup_seconds, 65));
      v_max_wait_until := GREATEST(
        v_first_at + make_interval(secs => GREATEST(p_max_seconds, 65)),
        v_scheduled_for
      );
    ELSE
      -- Meta Cloud preserves the configured initial/follow-up/absolute max.
      v_max_wait_until := v_first_at + make_interval(secs => p_max_seconds);
      v_scheduled_for := LEAST(
        v_last_at + make_interval(secs => p_followup_seconds),
        v_max_wait_until
      );
    END IF;

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
  v_max_wait_until := p_received_at + make_interval(
    secs => CASE WHEN p_channel = 'evolution' THEN GREATEST(p_max_seconds, 65) ELSE p_max_seconds END
  );
  IF p_channel = 'evolution' THEN
    v_scheduled_for := p_received_at + make_interval(secs => GREATEST(p_initial_seconds, 65));
    v_max_wait_until := GREATEST(v_max_wait_until, v_scheduled_for);
  ELSE
    v_scheduled_for := LEAST(
      p_received_at + make_interval(secs => p_initial_seconds),
      v_max_wait_until
    );
  END IF;

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

REVOKE ALL ON FUNCTION public.upsert_agent_response_job_burst_v4(
  text, text, text, text, text, text, uuid, timestamptz, timestamptz,
  integer, integer, integer, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_agent_response_job_burst_v4(
  text, text, text, text, text, text, uuid, timestamptz, timestamptz,
  integer, integer, integer, uuid, uuid
) TO service_role;
