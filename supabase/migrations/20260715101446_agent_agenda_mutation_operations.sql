-- Durable, tenant-safe agenda mutations emitted by AI agents.
-- The advisory lock serializes availability checks and writes for one tenant,
-- while operation_key makes webhook/job retries idempotent.

-- The runtime has supported all-day events for a long time, but older
-- installations may not have this column recorded in their migration history.
ALTER TABLE public.agenda_events
  ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.agenda_mutation_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  operation_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('schedule', 'cancel', 'scheduled', 'rescheduled', 'cancelled')),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'local_committed', 'sync_pending', 'completed', 'failed')),
  event_id uuid NULL REFERENCES public.agenda_events(id) ON DELETE SET NULL,
  previous_event_id uuid NULL REFERENCES public.agenda_events(id) ON DELETE SET NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_key)
);

CREATE INDEX IF NOT EXISTS agenda_mutation_operations_sync_pending_idx
  ON public.agenda_mutation_operations (tenant_id, updated_at)
  WHERE status = 'sync_pending';

ALTER TABLE public.agenda_mutation_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_mutation_operations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agenda_mutation_operations TO service_role;

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
  p_allow_simultaneous boolean
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

  -- Serialize every availability check/write for this tenant. Different tenants
  -- remain independent and can mutate their calendars concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended('agent-agenda:' || p_tenant_id, 0));

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
    tenant_id,
    operation_key,
    action,
    status,
    last_error,
    updated_at
  ) VALUES (
    p_tenant_id,
    p_operation_key,
    p_action,
    'processing',
    NULL,
    now()
  )
  ON CONFLICT (tenant_id, operation_key) DO UPDATE
    SET action = EXCLUDED.action,
        status = 'processing',
        last_error = NULL,
        updated_at = now();

  IF p_action = 'cancel' THEN
    IF p_event_id IS NOT NULL THEN
      SELECT *
        INTO v_event
        FROM public.agenda_events
       WHERE tenant_id = p_tenant_id
         AND id = p_event_id
       FOR UPDATE;
    ELSE
      SELECT *
        INTO v_event
        FROM public.agenda_events
       WHERE tenant_id = p_tenant_id
         AND attendee_phone = p_attendee_phone
         AND status <> 'cancelled'
         AND start_at >= now()
       ORDER BY start_at ASC
       LIMIT 1
       FOR UPDATE;
    END IF;

    IF v_event.id IS NULL THEN
      RAISE EXCEPTION 'agenda_event_not_found';
    END IF;
    IF v_event.attendee_phone IS DISTINCT FROM p_attendee_phone THEN
      RAISE EXCEPTION 'agenda_event_contact_mismatch';
    END IF;

    v_previous := v_event;
    UPDATE public.agenda_events
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_event.id
     RETURNING * INTO v_event;
    v_final_action := 'cancelled';
  ELSE
    IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at OR p_start_at <= now() THEN
      RAISE EXCEPTION 'invalid_or_past_agenda_datetime';
    END IF;

    SELECT *
      INTO v_previous
      FROM public.agenda_events
     WHERE tenant_id = p_tenant_id
       AND attendee_phone = p_attendee_phone
       AND status <> 'cancelled'
       AND start_at >= now()
     ORDER BY start_at ASC
     LIMIT 1
     FOR UPDATE;

    IF v_previous.id IS NOT NULL AND v_previous.start_at = p_start_at THEN
      v_event := v_previous;
      v_final_action := 'scheduled';
    ELSE
      IF NOT coalesce(p_allow_simultaneous, true) AND EXISTS (
        SELECT 1
          FROM public.agenda_events candidate
         WHERE candidate.tenant_id = p_tenant_id
           AND candidate.status <> 'cancelled'
           AND (v_previous.id IS NULL OR candidate.id <> v_previous.id)
           AND candidate.start_at < p_end_at
           AND candidate.end_at > p_start_at
      ) THEN
        RAISE EXCEPTION 'agenda_slot_taken';
      END IF;

      INSERT INTO public.agenda_events (
        tenant_id,
        google_event_id,
        title,
        description,
        location,
        color,
        start_at,
        end_at,
        all_day,
        attendee_name,
        attendee_phone,
        attendee_email,
        status,
        created_by,
        lead_id,
        agent_id,
        updated_at
      ) VALUES (
        p_tenant_id,
        NULL,
        p_title,
        p_description,
        p_location,
        '#f24400',
        p_start_at,
        p_end_at,
        false,
        p_attendee_name,
        p_attendee_phone,
        NULL,
        'pending',
        'agent',
        p_lead_id,
        p_agent_id,
        now()
      ) RETURNING * INTO v_event;

      IF v_previous.id IS NOT NULL THEN
        UPDATE public.agenda_events
           SET status = 'cancelled',
               updated_at = now()
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
    INSERT INTO public.agenda_mutation_operations (
      tenant_id,
      operation_key,
      action,
      status,
      last_error,
      updated_at
    ) VALUES (
      p_tenant_id,
      p_operation_key,
      CASE WHEN p_action IN ('schedule', 'cancel') THEN p_action ELSE 'schedule' END,
      'failed',
      SQLERRM,
      now()
    )
    ON CONFLICT (tenant_id, operation_key) DO UPDATE
      SET status = 'failed',
          last_error = EXCLUDED.last_error,
          updated_at = now();
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_agent_agenda_mutation(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_agent_agenda_mutation(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean
) TO service_role;
