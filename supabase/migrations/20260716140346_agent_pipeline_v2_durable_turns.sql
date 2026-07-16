-- Pipeline unificado e durável do agente (Evolution + Meta Cloud), alinhado
-- à versão registrada no histórico remoto de migrations.
-- A migração é aditiva e compatível com o código anterior: o RPC v1 permanece
-- disponível até a aplicação v2 estar publicada.

ALTER TABLE public.agent_response_jobs
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS connection_id text NULL,
  ADD COLUMN IF NOT EXISTS claim_token uuid NULL,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz NULL;

-- Remove a concatenação histórica de identidade/objetivo/regras da coluna
-- principal. Os campos continuam preservados no metadata e são montados uma
-- única vez no runtime.
UPDATE public.tenant_agents
   SET system_prompt = CASE
     WHEN metadata->>'instructionMode' = 'simple'
       THEN COALESCE(NULLIF(btrim(metadata->>'simplePrompt'), ''), system_prompt)
     ELSE COALESCE(NULLIF(btrim(metadata->>'systemPrompt'), ''), system_prompt)
   END,
       updated_at = now()
 WHERE metadata IS NOT NULL
   AND (
     NULLIF(btrim(metadata->>'simplePrompt'), '') IS NOT NULL
     OR NULLIF(btrim(metadata->>'systemPrompt'), '') IS NOT NULL
   );

ALTER TABLE public.agent_response_jobs
  DROP CONSTRAINT IF EXISTS agent_response_jobs_channel_check;
ALTER TABLE public.agent_response_jobs
  ADD CONSTRAINT agent_response_jobs_channel_check
  CHECK (channel IN ('evolution', 'meta_cloud'));

DROP INDEX IF EXISTS public.agent_response_jobs_pending_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS agent_response_jobs_open_channel_unique_idx
  ON public.agent_response_jobs (
    tenant_id,
    remote_jid,
    channel,
    COALESCE(connection_id, '')
  )
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS agent_response_jobs_claim_expiry_idx
  ON public.agent_response_jobs (status, claim_expires_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.upsert_agent_response_job_burst_v2(
  p_tenant_id text,
  p_remote_jid text,
  p_agent_id text,
  p_instance_name text,
  p_channel text,
  p_connection_id text,
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
BEGIN
  IF NULLIF(btrim(p_tenant_id), '') IS NULL
     OR NULLIF(btrim(p_remote_jid), '') IS NULL
     OR NULLIF(btrim(p_agent_id), '') IS NULL
     OR NULLIF(btrim(p_instance_name), '') IS NULL
     OR p_channel NOT IN ('evolution', 'meta_cloud')
     OR p_message_id IS NULL
     OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'invalid_agent_response_job_params';
  END IF;
  IF p_initial_seconds < 0 OR p_followup_seconds < 0 OR p_max_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid_agent_response_wait_settings';
  END IF;

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
           channel = p_channel,
           connection_id = p_connection_id,
           first_message_at = v_first_at,
           last_message_at = v_last_at,
           scheduled_for = v_scheduled_for,
           max_wait_until = v_max_wait_until,
           message_ids = v_message_ids,
           inbound_message_count = jsonb_array_length(v_message_ids),
           burst_generation = v_job.burst_generation + 1,
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
    tenant_id, lead_id, journey_id, remote_jid, agent_id, instance_name,
    channel, connection_id, status, first_message_at, last_message_at,
    scheduled_for, max_wait_until, message_ids, inbound_message_count,
    burst_generation
  ) VALUES (
    p_tenant_id, p_lead_id, p_journey_id, p_remote_jid, p_agent_id,
    p_instance_name, p_channel, p_connection_id, 'pending', v_first_at,
    v_last_at, v_scheduled_for, v_max_wait_until,
    jsonb_build_array(p_message_id::text), 1, 1
  ) RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_agent_response_job_burst_v2(
  text, text, text, text, text, text, uuid, timestamptz,
  integer, integer, integer, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_agent_response_job_burst_v2(
  text, text, text, text, text, text, uuid, timestamptz,
  integer, integer, integer, uuid, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_agent_response_job_v2(
  p_job_id uuid,
  p_claim_token uuid,
  p_claim_ttl_seconds integer DEFAULT 180
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job public.agent_response_jobs%ROWTYPE;
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid_agent_response_claim';
  END IF;

  SELECT * INTO v_job
    FROM public.agent_response_jobs
   WHERE id = p_job_id
   FOR UPDATE;

  IF NOT FOUND OR v_job.status <> 'pending' OR v_job.scheduled_for > now() THEN
    RETURN NULL;
  END IF;

  UPDATE public.agent_response_jobs
     SET status = 'processing',
         claim_token = p_claim_token,
         claim_expires_at = now() + make_interval(secs => greatest(30, p_claim_ttl_seconds)),
         locked_at = now(),
         attempt_count = attempt_count + 1,
         updated_at = now()
   WHERE id = p_job_id
   RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_response_job_v2(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_response_job_v2(uuid, uuid, integer)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.agent_outbound_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  job_id uuid NOT NULL REFERENCES public.agent_response_jobs(id) ON DELETE CASCADE,
  burst_generation integer NOT NULL,
  channel text NOT NULL CHECK (channel IN ('evolution', 'meta_cloud')),
  connection_id text NULL,
  remote_jid text NOT NULL,
  agent_id text NOT NULL,
  lead_id uuid NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  journey_id uuid NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'audio')),
  content text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'failed', 'ambiguous', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  claim_token uuid NULL,
  claim_expires_at timestamptz NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text NULL,
  last_error text NULL,
  sent_at timestamptz NULL,
  delivered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, burst_generation, kind)
);

CREATE INDEX IF NOT EXISTS agent_outbound_outbox_claimable_idx
  ON public.agent_outbound_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'processing');
ALTER TABLE public.agent_outbound_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_outbound_outbox FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_outbound_outbox TO service_role;

CREATE TABLE IF NOT EXISTS public.agent_agenda_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  remote_jid text NOT NULL,
  journey_id uuid NULL,
  agent_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'reschedule', 'cancel')),
  event_id uuid NULL REFERENCES public.agenda_events(id) ON DELETE SET NULL,
  proposed_date text NULL,
  proposed_time text NULL,
  proposed_location text NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'confirmed', 'executed', 'expired', 'cancelled')),
  source_job_id uuid NULL REFERENCES public.agent_response_jobs(id) ON DELETE SET NULL,
  source_generation integer NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_agenda_pending_actions_open_idx
  ON public.agent_agenda_pending_actions (tenant_id, remote_jid, agent_id)
  WHERE state = 'pending';
ALTER TABLE public.agent_agenda_pending_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_agenda_pending_actions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_agenda_pending_actions TO service_role;

CREATE TABLE IF NOT EXISTS public.agenda_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  operation_key text NOT NULL,
  agenda_event_id uuid NULL REFERENCES public.agenda_events(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('scheduled', 'rescheduled', 'cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  claim_token uuid NULL,
  claim_expires_at timestamptz NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_key, action)
);
CREATE INDEX IF NOT EXISTS agenda_sync_outbox_claimable_idx
  ON public.agenda_sync_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'processing');
ALTER TABLE public.agenda_sync_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_sync_outbox FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agenda_sync_outbox TO service_role;

-- Materializa, na mesma transação da mutação local, as obrigações de
-- sincronização e notificação. Os inserts posteriores do código legado são
-- absorvidos pelas chaves únicas e permanecem idempotentes.
CREATE OR REPLACE FUNCTION public.enqueue_agent_agenda_side_effects_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_event jsonb;
  v_phone text;
  v_changed boolean;
BEGIN
  IF NEW.status <> 'local_committed' OR NEW.result IS NULL THEN
    RETURN NEW;
  END IF;
  v_changed := COALESCE((NEW.result->>'changed')::boolean, false);
  v_action := NULLIF(NEW.result->>'action', '');
  v_event := NEW.result->'event';
  IF NOT v_changed OR v_action NOT IN ('scheduled', 'rescheduled', 'cancelled')
     OR NULLIF(v_event->>'id', '') IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT appointment_notification_phone INTO v_phone
    FROM public.tenants WHERE id = NEW.tenant_id;

  INSERT INTO public.agenda_notification_outbox (
    tenant_id, agenda_event_id, action, operation_key, phone_last4,
    payload, status, last_error, next_attempt_at, updated_at
  ) VALUES (
    NEW.tenant_id, (v_event->>'id')::uuid, v_action, NEW.operation_key,
    CASE WHEN NULLIF(v_phone, '') IS NULL THEN NULL ELSE right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 4) END,
    jsonb_build_object(
      'phone', COALESCE(v_phone, ''),
      'attendeeName', v_event->>'attendee_name',
      'attendeePhone', v_event->>'attendee_phone',
      'startAtIso', v_event->>'start_at',
      'location', v_event->>'location',
      'agent_id', v_event->>'agent_id'
    ),
    CASE WHEN NULLIF(v_phone, '') IS NULL THEN 'skipped' ELSE 'pending' END,
    CASE WHEN NULLIF(v_phone, '') IS NULL THEN 'missing_appointment_notification_phone' ELSE NULL END,
    now(), now()
  ) ON CONFLICT (tenant_id, operation_key, action) DO NOTHING;

  INSERT INTO public.agenda_sync_outbox (
    tenant_id, operation_key, agenda_event_id, action, payload
  ) VALUES (
    NEW.tenant_id, NEW.operation_key, (v_event->>'id')::uuid, v_action,
    jsonb_build_object('result', NEW.result)
  ) ON CONFLICT (tenant_id, operation_key, action) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_agent_agenda_side_effects_v2()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_agenda_side_effects_v2_trg
  ON public.agenda_mutation_operations;
CREATE TRIGGER agent_agenda_side_effects_v2_trg
AFTER INSERT OR UPDATE OF status, result ON public.agenda_mutation_operations
FOR EACH ROW EXECUTE FUNCTION public.enqueue_agent_agenda_side_effects_v2();

-- O reconciliador também considera operações cujo commit local já aconteceu,
-- mas cuja sincronização externa segue pendente.
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
  WHERE o.status IN ('local_committed', 'sync_pending', 'completed')
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
