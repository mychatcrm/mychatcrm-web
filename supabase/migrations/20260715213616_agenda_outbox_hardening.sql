-- Hardening da outbox de notificações e da mutação atômica de agenda.
-- Aditiva e compatível com o código publicado (770ab52):
--   * novas colunas nullable + CHECK de status ampliado (valores antigos válidos);
--   * claim transacional (FOR UPDATE SKIP LOCKED) para envio idempotente;
--   * índice na FK agenda_event_id (advisor unindexed_foreign_keys);
--   * apply_agent_agenda_mutation ganha checagem atômica de generation (params
--     novos com DEFAULT NULL → chamadas nomeadas de 14 args continuam válidas).
-- Reversível: DROP FUNCTION claim_agenda_notifications; DROP COLUMN ...; recriar
-- apply_agent_agenda_mutation na assinatura antiga. Sem DROP da outbox, sem perda.

-- ── 1. Colunas de claim / máquina de entrega ────────────────────────────────
ALTER TABLE public.agenda_notification_outbox
  ADD COLUMN IF NOT EXISTS claim_token uuid NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS provider_message_id text NULL,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz NULL;

ALTER TABLE public.agenda_notification_outbox
  DROP CONSTRAINT IF EXISTS agenda_notification_outbox_status_check;
ALTER TABLE public.agenda_notification_outbox
  ADD CONSTRAINT agenda_notification_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'failed', 'skipped'));

-- FK sem índice (advisor) + índice de varredura de claim.
CREATE INDEX IF NOT EXISTS agenda_notification_outbox_agenda_event_id_idx
  ON public.agenda_notification_outbox (agenda_event_id);
CREATE INDEX IF NOT EXISTS agenda_notification_outbox_claimable_idx
  ON public.agenda_notification_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'processing', 'sent');

-- ── 2. Claim transacional idempotente de envio ──────────────────────────────
-- Reivindica linhas prontas (pending vencidas OU processing abandonadas após o
-- TTL) com FOR UPDATE SKIP LOCKED, marca processing + claim_token, e retorna só
-- as linhas deste worker. delivered/failed/skipped nunca são reivindicadas.
CREATE OR REPLACE FUNCTION public.claim_agenda_notifications(
  p_limit integer,
  p_claim_ttl_seconds integer
) RETURNS SETOF public.agenda_notification_outbox
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id
      FROM public.agenda_notification_outbox
     WHERE (
             (status = 'pending' AND next_attempt_at <= now())
             OR (status = 'processing' AND claimed_at < now() - make_interval(secs => greatest(p_claim_ttl_seconds, 30)))
           )
     ORDER BY next_attempt_at ASC
     LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.agenda_notification_outbox o
     SET status = 'processing',
         claim_token = v_token,
         claimed_at = now(),
         updated_at = now()
    FROM claimable c
   WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agenda_notifications(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agenda_notifications(integer, integer) TO service_role;

-- ── 3. Mutação de agenda com checagem atômica de generation ─────────────────
-- Recria a função com 2 params novos ao FINAL com DEFAULT NULL. Chamadas
-- nomeadas de 14 args (770ab52) permanecem válidas. Quando p_job_id e
-- p_claimed_generation vêm preenchidos (caminho de job), valida a generation
-- SOB o advisory lock antes de qualquer escrita: obsoleta → generation_stale,
-- zero mutação. Webhook direto (params NULL) mantém o comportamento atual.
DROP FUNCTION IF EXISTS public.apply_agent_agenda_mutation(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean
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
  p_job_id text DEFAULT NULL,
  p_claimed_generation integer DEFAULT NULL
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

  -- Serialize every availability check/write for this tenant.
  PERFORM pg_advisory_xact_lock(hashtextextended('agent-agenda:' || p_tenant_id, 0));

  -- Barreira de staleness ATÔMICA (sob o lock): se a geração deste job já foi
  -- superada por uma mensagem mais nova, ou o job foi cancelado, aborta antes de
  -- qualquer escrita — zero mutação, zero outbox, operation_key não consumida.
  IF p_job_id IS NOT NULL AND p_claimed_generation IS NOT NULL THEN
    SELECT burst_generation, status
      INTO v_job_generation, v_job_status
      FROM public.agent_response_jobs
     WHERE id = p_job_id;
    IF NOT FOUND OR v_job_status = 'cancelled' OR coalesce(v_job_generation, 1) <> p_claimed_generation THEN
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
    -- generation_stale não deve poluir a operação como 'failed' nem consumir a
    -- operation_key: apenas propaga para o worker abortar silenciosamente.
    IF SQLERRM = 'generation_stale' THEN
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
  text, uuid, text, boolean, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_agent_agenda_mutation(
  text, text, text, text, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, text, boolean, text, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
