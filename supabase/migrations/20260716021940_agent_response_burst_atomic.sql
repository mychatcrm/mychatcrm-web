-- Serializa a criação/reagendamento do burst do agente por conversa.
--
-- Antes desta função, dois webhooks concorrentes faziam SELECT + UPDATE no
-- TypeScript. Ambos podiam ler os mesmos message_ids e a última gravação
-- sobrescrevia a outra, fazendo o agente responder sem a mensagem mais nova.

CREATE OR REPLACE FUNCTION public.upsert_agent_response_job_burst(
  p_tenant_id text,
  p_remote_jid text,
  p_agent_id text,
  p_instance_name text,
  p_message_id uuid,
  p_occurred_at timestamptz,
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
  v_first_at timestamptz;
  v_last_at timestamptz;
  v_max_wait_until timestamptz;
  v_scheduled_for timestamptz;
  v_message_ids jsonb;
  v_message_count integer;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id) = ''
     OR p_remote_jid IS NULL OR btrim(p_remote_jid) = ''
     OR p_agent_id IS NULL OR btrim(p_agent_id) = ''
     OR p_instance_name IS NULL OR btrim(p_instance_name) = ''
     OR p_message_id IS NULL
     OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'invalid_agent_response_job_params';
  END IF;

  IF p_initial_seconds < 0 OR p_followup_seconds < 0 OR p_max_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid_agent_response_wait_settings';
  END IF;

  -- Ponto de linearização: uma conversa (tenant + JID) só pode anexar uma
  -- mensagem por vez, inclusive quando ainda não existe linha para bloquear.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('agent-response:' || p_tenant_id || ':' || p_remote_jid, 0)
  );

  SELECT *
    INTO v_job
    FROM public.agent_response_jobs
   WHERE tenant_id = p_tenant_id
     AND remote_jid = p_remote_jid
     AND status IN ('pending', 'processing')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  -- Uma jornada nova nunca reaproveita o burst da jornada antiga. Cancela a
  -- geração anterior sob o mesmo lock antes de criar o novo job.
  IF FOUND AND v_job.journey_id IS DISTINCT FROM p_journey_id THEN
    UPDATE public.agent_response_jobs
       SET status = 'cancelled',
           failed_reason = 'journey_replaced',
           completed_at = now(),
           updated_at = now()
     WHERE id = v_job.id;
    v_job.id := NULL;
  END IF;

  IF v_job.id IS NOT NULL THEN
    -- Webhook repetido é idempotente: não duplica message_id, contagem nem
    -- generation.
    IF COALESCE(v_job.message_ids, '[]'::jsonb) @> jsonb_build_array(p_message_id::text) THEN
      RETURN to_jsonb(v_job);
    END IF;

    v_message_ids := COALESCE(v_job.message_ids, '[]'::jsonb)
      || jsonb_build_array(p_message_id::text);
    v_message_count := jsonb_array_length(v_message_ids);
    v_first_at := LEAST(v_job.first_message_at, p_occurred_at);
    v_last_at := GREATEST(v_job.last_message_at, p_occurred_at);
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
           first_message_at = v_first_at,
           last_message_at = v_last_at,
           scheduled_for = v_scheduled_for,
           max_wait_until = v_max_wait_until,
           message_ids = v_message_ids,
           inbound_message_count = v_message_count,
           burst_generation = v_job.burst_generation + 1,
           status = CASE WHEN v_job.status = 'processing' THEN 'processing' ELSE 'pending' END,
           locked_at = CASE WHEN v_job.status = 'processing' THEN v_job.locked_at ELSE NULL END,
           completed_at = NULL,
           failed_reason = NULL,
           updated_at = now()
     WHERE id = v_job.id
     RETURNING * INTO v_job;

    RETURN to_jsonb(v_job);
  END IF;

  v_first_at := p_occurred_at;
  v_last_at := p_occurred_at;
  v_max_wait_until := p_occurred_at + make_interval(secs => p_max_seconds);
  v_scheduled_for := LEAST(
    p_occurred_at + make_interval(secs => p_initial_seconds),
    v_max_wait_until
  );

  INSERT INTO public.agent_response_jobs (
    tenant_id,
    lead_id,
    journey_id,
    remote_jid,
    agent_id,
    instance_name,
    status,
    first_message_at,
    last_message_at,
    scheduled_for,
    max_wait_until,
    message_ids,
    inbound_message_count,
    burst_generation
  ) VALUES (
    p_tenant_id,
    p_lead_id,
    p_journey_id,
    p_remote_jid,
    p_agent_id,
    p_instance_name,
    'pending',
    v_first_at,
    v_last_at,
    v_scheduled_for,
    v_max_wait_until,
    jsonb_build_array(p_message_id::text),
    1,
    1
  )
  RETURNING * INTO v_job;

  RETURN to_jsonb(v_job);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_agent_response_job_burst(
  text, text, text, text, uuid, timestamptz, integer, integer, integer, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_agent_response_job_burst(
  text, text, text, text, uuid, timestamptz, integer, integer, integer, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION public.upsert_agent_response_job_burst(
  text, text, text, text, uuid, timestamptz, integer, integer, integer, uuid, uuid
) IS 'Cria ou anexa atomicamente mensagens ao burst do agente, sem lost update entre webhooks concorrentes.';

NOTIFY pgrst, 'reload schema';
