-- Corretiva aditiva sobre 20260715213616 (NÃO altera essa migration).
-- - p_job_id uuid + p_journey_id + all-or-none + FOR UPDATE + tenant/journey
-- - list_missing_agenda_notification_ops (anti-join paginado por cursor)
-- Compatível com chamadas nomeadas de 14 args (770ab52) via DEFAULT NULL.

-- ── 1. Substituir assinatura text por uuid + journey ─────────────────────────
DROP FUNCTION IF EXISTS public.apply_agent_agenda_mutation(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean, text, integer
);

CREATE OR REPLACE FUNCTION public.apply_agent_agenda_mutation(
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
  p_job_id uuid DEFAULT NULL,
  p_claimed_generation integer DEFAULT NULL,
  p_journey_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_operation public.agenda_mutation_operations%ROWTYPE;
  v_event public.agenda_events%ROWTYPE;
  v_previous public.agenda_events%ROWTYPE;
  v_result jsonb;
  v_final_action text;
  v_job_generation integer;
  v_job_status text;
  v_job_tenant text;
  v_job_journey uuid;
BEGIN
  IF nullif(btrim(p_tenant_id), '') IS NULL OR nullif(btrim(p_operation_key), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_agenda_operation_key';
  END IF;
  IF p_action NOT IN ('schedule', 'cancel') THEN
    RAISE EXCEPTION 'invalid_agenda_operation_action';
  END IF;
  IF nullif(regexp_replace(coalesce(p_attendee_phone, ''), '\D', '', 'g'), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_remote_jid';
  END IF;

  -- All-or-none: job_id e generation juntos, ou ambos NULL (path webhook/legado).
  IF (p_job_id IS NULL) <> (p_claimed_generation IS NULL) THEN
    RAISE EXCEPTION 'invalid_job_params';
  END IF;

  -- Serialize every availability check/write for this tenant.
  PERFORM pg_advisory_xact_lock(hashtextextended('agent-agenda:' || p_tenant_id, 0));

  -- Barreira de staleness ATÔMICA (sob advisory + FOR UPDATE no job).
  IF p_job_id IS NOT NULL AND p_claimed_generation IS NOT NULL THEN
    SELECT burst_generation, status, tenant_id, journey_id
      INTO v_job_generation, v_job_status, v_job_tenant, v_job_journey
      FROM public.agent_response_jobs
     WHERE id = p_job_id
     FOR UPDATE;

    IF NOT FOUND
       OR v_job_status = 'cancelled'
       OR coalesce(v_job_generation, 1) <> p_claimed_generation
       OR v_job_tenant IS DISTINCT FROM p_tenant_id
       OR (v_job_journey IS NOT NULL AND (p_journey_id IS NULL OR p_journey_id IS DISTINCT FROM v_job_journey))
       OR (v_job_journey IS NULL AND p_journey_id IS NOT NULL)
    THEN
      RAISE EXCEPTION 'generation_stale';
    END IF;
  END IF;

  SELECT *
    INTO v_existing_operation
    FROM public.agenda_mutation_operations
   WHERE tenant_id = p_tenant_id
     AND operation_key = p_operation_key;

  IF FOUND
     AND v_existing_operation.status IN ('local_committed', 'sync_pending', 'completed')
     AND v_existing_operation.result ? 'event' THEN
    RETURN v_existing_operation.result || jsonb_build_object(
      'deduplicated', true,
      'operation_status', v_existing_operation.status
    );
  END IF;

  INSERT INTO public.agenda_mutation_operations (
    tenant_id, operation_key, action, status, last_error, updated_at
  ) VALUES (
    p_tenant_id, p_operation_key, p_action, 'processing', NULL, now()
  )
  ON CONFLICT (tenant_id, operation_key) DO UPDATE
    SET action = EXCLUDED.action, status = 'processing', last_error = NULL, updated_at = now();

  IF p_action = 'cancel' THEN
    IF p_event_id IS NOT NULL THEN
      SELECT * INTO v_event FROM public.agenda_events
       WHERE tenant_id = p_tenant_id AND id = p_event_id FOR UPDATE;
    ELSE
      SELECT * INTO v_event FROM public.agenda_events
       WHERE tenant_id = p_tenant_id AND attendee_phone = p_attendee_phone
         AND status <> 'cancelled' AND start_at >= now()
       ORDER BY start_at ASC LIMIT 1 FOR UPDATE;
    END IF;

    IF v_event.id IS NULL THEN
      RAISE EXCEPTION 'agenda_event_not_found';
    END IF;
    IF v_event.attendee_phone IS DISTINCT FROM p_attendee_phone THEN
      RAISE EXCEPTION 'agenda_event_contact_mismatch';
    END IF;

    v_previous := v_event;
    UPDATE public.agenda_events
       SET status = 'cancelled', updated_at = now()
     WHERE id = v_event.id
     RETURNING * INTO v_event;
    v_final_action := 'cancelled';
  ELSE
    IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at OR p_start_at <= now() THEN
      RAISE EXCEPTION 'invalid_or_past_agenda_datetime';
    END IF;

    SELECT * INTO v_previous FROM public.agenda_events
     WHERE tenant_id = p_tenant_id AND attendee_phone = p_attendee_phone
       AND status <> 'cancelled' AND start_at >= now()
     ORDER BY start_at ASC LIMIT 1 FOR UPDATE;

    IF v_previous.id IS NOT NULL AND v_previous.start_at = p_start_at THEN
      v_event := v_previous;
      v_final_action := 'scheduled';
    ELSE
      IF NOT coalesce(p_allow_simultaneous, true) AND EXISTS (
        SELECT 1 FROM public.agenda_events candidate
         WHERE candidate.tenant_id = p_tenant_id
           AND candidate.status <> 'cancelled'
           AND (v_previous.id IS NULL OR candidate.id <> v_previous.id)
           AND candidate.start_at < p_end_at
           AND candidate.end_at > p_start_at
      ) THEN
        RAISE EXCEPTION 'agenda_slot_taken';
      END IF;

      INSERT INTO public.agenda_events (
        tenant_id, google_event_id, title, description, location, color,
        start_at, end_at, all_day, attendee_name, attendee_phone, attendee_email,
        status, created_by, lead_id, agent_id, updated_at
      ) VALUES (
        p_tenant_id, NULL, p_title, p_description, p_location, '#f24400',
        p_start_at, p_end_at, false, p_attendee_name, p_attendee_phone, NULL,
        'pending', 'agent', p_lead_id, p_agent_id, now()
      ) RETURNING * INTO v_event;

      IF v_previous.id IS NOT NULL THEN
        UPDATE public.agenda_events
           SET status = 'cancelled', updated_at = now()
         WHERE id = v_previous.id;
        v_final_action := 'rescheduled';
      ELSE
        v_final_action := 'scheduled';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'action', v_final_action,
    'event', to_jsonb(v_event),
    'previous_event', CASE WHEN v_previous.id IS NULL THEN NULL ELSE to_jsonb(v_previous) END,
    'changed', NOT (p_action = 'schedule' AND v_previous.id IS NOT NULL AND v_event.id = v_previous.id),
    'deduplicated', false,
    'operation_status', 'local_committed'
  );

  UPDATE public.agenda_mutation_operations
     SET action = v_final_action,
         status = 'local_committed',
         event_id = v_event.id,
         previous_event_id = CASE WHEN v_previous.id = v_event.id THEN NULL ELSE v_previous.id END,
         result = v_result,
         last_error = NULL,
         updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND operation_key = p_operation_key;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM IN ('generation_stale', 'invalid_job_params') THEN
      RAISE;
    END IF;
    INSERT INTO public.agenda_mutation_operations (
      tenant_id, operation_key, action, status, last_error, updated_at
    ) VALUES (
      p_tenant_id, p_operation_key,
      CASE WHEN p_action IN ('schedule', 'cancel') THEN p_action ELSE 'schedule' END,
      'failed', SQLERRM, now()
    )
    ON CONFLICT (tenant_id, operation_key) DO UPDATE
      SET status = 'failed', last_error = EXCLUDED.last_error, updated_at = now();
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_agent_agenda_mutation(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean, uuid, integer, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_agent_agenda_mutation(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean, uuid, integer, uuid
) TO service_role;

-- ── 2. Reconcile paginado: só ops realmente sem outbox ───────────────────────
CREATE OR REPLACE FUNCTION public.list_missing_agenda_notification_ops(
  p_cursor_updated_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
) RETURNS TABLE (
  tenant_id text,
  operation_key text,
  updated_at timestamptz,
  operation_id uuid,
  result jsonb
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    o.tenant_id,
    o.operation_key,
    o.updated_at,
    o.id AS operation_id,
    o.result
  FROM public.agenda_mutation_operations o
  WHERE o.status IN ('local_committed', 'completed')
    AND coalesce((o.result->>'changed')::boolean, false) = true
    AND nullif(o.result->>'action', '') IS NOT NULL
    AND nullif(o.result->'event'->>'id', '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM public.agenda_notification_outbox x
       WHERE x.tenant_id = o.tenant_id
         AND x.operation_key = o.operation_key
         AND x.action = (o.result->>'action')
    )
    AND (
      p_cursor_updated_at IS NULL
      OR (o.updated_at, o.id) > (p_cursor_updated_at, p_cursor_id)
    )
  ORDER BY o.updated_at ASC, o.id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.list_missing_agenda_notification_ops(timestamptz, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_missing_agenda_notification_ops(timestamptz, uuid, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
