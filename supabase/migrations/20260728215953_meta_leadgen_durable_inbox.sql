-- Durable, idempotent ingress for Meta Lead Ads webhook events.
--
-- The webhook stores only provider identifiers needed to retrieve the lead.
-- Contact fields and the raw webhook payload are deliberately not persisted in
-- this queue. Workers claim rows transactionally and all RPCs are restricted to
-- service_role.

CREATE TABLE IF NOT EXISTS public.meta_leadgen_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id text NOT NULL,
  leadgen_id text NOT NULL,
  form_id text NULL,
  ad_id text NULL,
  ad_group_id text NULL,
  event_field text NOT NULL DEFAULT 'leadgen',
  provider_created_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid NULL,
  claimed_at timestamptz NULL,
  last_attempt_at timestamptz NULL,
  completed_at timestamptz NULL,
  dead_lettered_at timestamptz NULL,
  last_error_code text NULL,
  error_fingerprint text NULL,
  duplicate_count integer NOT NULL DEFAULT 0,
  first_received_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_leadgen_inbox_event_unique UNIQUE (page_id, leadgen_id),
  CONSTRAINT meta_leadgen_inbox_page_id_check
    CHECK (length(btrim(page_id)) BETWEEN 1 AND 128),
  CONSTRAINT meta_leadgen_inbox_leadgen_id_check
    CHECK (length(btrim(leadgen_id)) BETWEEN 1 AND 128),
  CONSTRAINT meta_leadgen_inbox_form_id_check
    CHECK (form_id IS NULL OR length(btrim(form_id)) BETWEEN 1 AND 128),
  CONSTRAINT meta_leadgen_inbox_ad_id_check
    CHECK (ad_id IS NULL OR length(btrim(ad_id)) BETWEEN 1 AND 128),
  CONSTRAINT meta_leadgen_inbox_ad_group_id_check
    CHECK (ad_group_id IS NULL OR length(btrim(ad_group_id)) BETWEEN 1 AND 128),
  CONSTRAINT meta_leadgen_inbox_event_field_check
    CHECK (event_field IN ('leadgen', 'leadgen_update')),
  CONSTRAINT meta_leadgen_inbox_status_check
    CHECK (status IN ('pending', 'processing', 'retrying', 'completed', 'dead_letter')),
  CONSTRAINT meta_leadgen_inbox_attempts_check
    CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20),
  CONSTRAINT meta_leadgen_inbox_error_code_check
    CHECK (last_error_code IS NULL OR length(last_error_code) <= 96),
  CONSTRAINT meta_leadgen_inbox_error_fingerprint_check
    CHECK (error_fingerprint IS NULL OR error_fingerprint ~ '^[a-f0-9]{64}$')
);

COMMENT ON TABLE public.meta_leadgen_inbox IS
  'PII-free durable inbox for Meta leadgen provider identifiers.';
COMMENT ON COLUMN public.meta_leadgen_inbox.leadgen_id IS
  'Opaque Meta provider identifier; contact fields are never stored in this queue.';
COMMENT ON COLUMN public.meta_leadgen_inbox.error_fingerprint IS
  'SHA-256 fingerprint of a sanitized processing error; never the raw error text.';

CREATE INDEX IF NOT EXISTS meta_leadgen_inbox_claimable_idx
  ON public.meta_leadgen_inbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retrying', 'processing');

CREATE INDEX IF NOT EXISTS meta_leadgen_inbox_stale_claim_idx
  ON public.meta_leadgen_inbox (claimed_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS meta_leadgen_inbox_dead_letter_idx
  ON public.meta_leadgen_inbox (dead_lettered_at DESC)
  WHERE status = 'dead_letter';

CREATE TABLE IF NOT EXISTS public.meta_leadgen_inbox_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_id uuid NOT NULL REFERENCES public.meta_leadgen_inbox(id) ON DELETE RESTRICT,
  failure_code text NOT NULL,
  error_fingerprint text NOT NULL,
  attempts integer NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_leadgen_inbox_failures_job_unique UNIQUE (inbox_id),
  CONSTRAINT meta_leadgen_inbox_failures_code_check
    CHECK (length(failure_code) BETWEEN 1 AND 96),
  CONSTRAINT meta_leadgen_inbox_failures_fingerprint_check
    CHECK (error_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT meta_leadgen_inbox_failures_attempts_check
    CHECK (attempts >= 1)
);

COMMENT ON TABLE public.meta_leadgen_inbox_failures IS
  'Immutable PII-free audit record for permanently failed Meta leadgen inbox jobs.';

ALTER TABLE public.meta_leadgen_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_leadgen_inbox_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meta_leadgen_inbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.meta_leadgen_inbox_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.meta_leadgen_inbox TO service_role;
GRANT SELECT, INSERT ON TABLE public.meta_leadgen_inbox_failures TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_meta_leadgen_events(
  p_events jsonb
) RETURNS TABLE (
  id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event jsonb;
  v_page_id text;
  v_leadgen_id text;
  v_form_id text;
  v_ad_id text;
  v_ad_group_id text;
  v_event_field text;
  v_created_seconds numeric;
  v_provider_created_at timestamptz;
  v_count integer;
BEGIN
  IF jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'meta_leadgen_events_must_be_array';
  END IF;

  v_count := jsonb_array_length(p_events);
  IF v_count < 1 OR v_count > 100 THEN
    RAISE EXCEPTION 'meta_leadgen_events_invalid_batch_size';
  END IF;

  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events)
  LOOP
    v_page_id := nullif(btrim(v_event ->> 'page_id'), '');
    v_leadgen_id := nullif(btrim(v_event ->> 'leadgen_id'), '');
    v_form_id := nullif(btrim(v_event ->> 'form_id'), '');
    v_ad_id := nullif(btrim(v_event ->> 'ad_id'), '');
    v_ad_group_id := nullif(btrim(v_event ->> 'ad_group_id'), '');
    v_event_field := coalesce(nullif(btrim(v_event ->> 'event_field'), ''), 'leadgen');

    IF v_page_id IS NULL OR length(v_page_id) > 128
       OR v_leadgen_id IS NULL OR length(v_leadgen_id) > 128
       OR (v_form_id IS NOT NULL AND length(v_form_id) > 128)
       OR (v_ad_id IS NOT NULL AND length(v_ad_id) > 128)
       OR (v_ad_group_id IS NOT NULL AND length(v_ad_group_id) > 128)
       OR v_event_field NOT IN ('leadgen', 'leadgen_update') THEN
      RAISE EXCEPTION 'meta_leadgen_event_invalid';
    END IF;

    BEGIN
      v_created_seconds := nullif(v_event ->> 'created_time', '')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'meta_leadgen_event_invalid_created_time';
    END;
    IF v_created_seconds IS NOT NULL
       AND (v_created_seconds < 0 OR v_created_seconds > 32503680000) THEN
      RAISE EXCEPTION 'meta_leadgen_event_invalid_created_time';
    END IF;
    v_provider_created_at := CASE
      WHEN v_created_seconds IS NULL THEN NULL
      ELSE to_timestamp(v_created_seconds)
    END;

    RETURN QUERY
    INSERT INTO public.meta_leadgen_inbox AS inbox (
      page_id,
      leadgen_id,
      form_id,
      ad_id,
      ad_group_id,
      event_field,
      provider_created_at
    ) VALUES (
      v_page_id,
      v_leadgen_id,
      v_form_id,
      v_ad_id,
      v_ad_group_id,
      v_event_field,
      v_provider_created_at
    )
    ON CONFLICT (page_id, leadgen_id) DO UPDATE
      SET form_id = coalesce(inbox.form_id, EXCLUDED.form_id),
          ad_id = coalesce(inbox.ad_id, EXCLUDED.ad_id),
          ad_group_id = coalesce(inbox.ad_group_id, EXCLUDED.ad_group_id),
          provider_created_at = coalesce(inbox.provider_created_at, EXCLUDED.provider_created_at),
          duplicate_count = inbox.duplicate_count + 1,
          last_received_at = now(),
          updated_at = now()
    RETURNING inbox.id, inbox.status;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_meta_leadgen_events(
  p_limit integer DEFAULT 5,
  p_claim_ttl_seconds integer DEFAULT 300,
  p_job_ids uuid[] DEFAULT NULL
) RETURNS SETOF public.meta_leadgen_inbox
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_claim_token uuid := gen_random_uuid();
BEGIN
  -- A worker can disappear after obtaining its final allowed claim. Reap that
  -- stale row into the terminal state before selecting new work; otherwise the
  -- attempts ceiling would leave it in `processing` forever.
  WITH terminal_claims AS (
    SELECT inbox.id
      FROM public.meta_leadgen_inbox AS inbox
     WHERE inbox.status = 'processing'
       AND inbox.attempts >= inbox.max_attempts
       AND inbox.claimed_at < now() - make_interval(secs => greatest(coalesce(p_claim_ttl_seconds, 300), 60))
       AND (p_job_ids IS NULL OR inbox.id = ANY(p_job_ids))
     ORDER BY inbox.claimed_at ASC
     LIMIT greatest(1, least(coalesce(p_limit, 5), 25))
     FOR UPDATE SKIP LOCKED
  ),
  terminalized AS (
    UPDATE public.meta_leadgen_inbox AS inbox
       SET status = 'dead_letter',
           dead_lettered_at = now(),
           claim_token = NULL,
           claimed_at = NULL,
           last_error_code = 'claim_expired_after_final_attempt',
           error_fingerprint = '7450c85008a0dae0bc95329b2b6922bbeaca4bb044a3e30a7dea92c65ff6f226',
           updated_at = now()
      FROM terminal_claims
     WHERE inbox.id = terminal_claims.id
    RETURNING inbox.id, inbox.attempts
  )
  INSERT INTO public.meta_leadgen_inbox_failures (
    inbox_id,
    failure_code,
    error_fingerprint,
    attempts
  )
  SELECT
    terminalized.id,
    'claim_expired_after_final_attempt',
    '7450c85008a0dae0bc95329b2b6922bbeaca4bb044a3e30a7dea92c65ff6f226',
    terminalized.attempts
  FROM terminalized
  ON CONFLICT (inbox_id) DO NOTHING;

  RETURN QUERY
  WITH claimable AS (
    SELECT inbox.id
      FROM public.meta_leadgen_inbox AS inbox
     WHERE inbox.attempts < inbox.max_attempts
       AND (
         (inbox.status IN ('pending', 'retrying') AND inbox.next_attempt_at <= now())
         OR (
           inbox.status = 'processing'
           AND inbox.claimed_at < now() - make_interval(secs => greatest(coalesce(p_claim_ttl_seconds, 300), 60))
         )
       )
       AND (p_job_ids IS NULL OR inbox.id = ANY(p_job_ids))
     ORDER BY inbox.next_attempt_at ASC, inbox.created_at ASC
     LIMIT greatest(1, least(coalesce(p_limit, 5), 25))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.meta_leadgen_inbox AS inbox
     SET status = 'processing',
         attempts = inbox.attempts + 1,
         claim_token = v_claim_token,
         claimed_at = now(),
         last_attempt_at = now(),
         last_error_code = NULL,
         error_fingerprint = NULL,
         updated_at = now()
    FROM claimable
   WHERE inbox.id = claimable.id
  RETURNING inbox.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_meta_leadgen_event(
  p_id uuid,
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.meta_leadgen_inbox
     SET status = 'completed',
         completed_at = now(),
         claim_token = NULL,
         claimed_at = NULL,
         next_attempt_at = now(),
         last_error_code = NULL,
         error_fingerprint = NULL,
         updated_at = now()
   WHERE id = p_id
     AND status = 'processing'
     AND claim_token = p_claim_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_meta_leadgen_event(
  p_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_fingerprint text,
  p_next_attempt_at timestamptz,
  p_force_terminal boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row public.meta_leadgen_inbox%ROWTYPE;
  v_terminal boolean;
  v_error_code text;
BEGIN
  v_error_code := left(coalesce(nullif(btrim(p_error_code), ''), 'processing_failed'), 96);
  IF p_error_fingerprint IS NULL OR p_error_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'meta_leadgen_invalid_error_fingerprint';
  END IF;

  SELECT *
    INTO v_row
    FROM public.meta_leadgen_inbox
   WHERE id = p_id
     AND status = 'processing'
     AND claim_token = p_claim_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'claim_lost';
  END IF;

  v_terminal := coalesce(p_force_terminal, false) OR v_row.attempts >= v_row.max_attempts;
  IF v_terminal THEN
    UPDATE public.meta_leadgen_inbox
       SET status = 'dead_letter',
           dead_lettered_at = now(),
           claim_token = NULL,
           claimed_at = NULL,
           last_error_code = v_error_code,
           error_fingerprint = p_error_fingerprint,
           updated_at = now()
     WHERE id = v_row.id;

    INSERT INTO public.meta_leadgen_inbox_failures (
      inbox_id,
      failure_code,
      error_fingerprint,
      attempts
    ) VALUES (
      v_row.id,
      v_error_code,
      p_error_fingerprint,
      v_row.attempts
    )
    ON CONFLICT (inbox_id) DO NOTHING;
    RETURN 'dead_letter';
  END IF;

  UPDATE public.meta_leadgen_inbox
     SET status = 'retrying',
         next_attempt_at = greatest(coalesce(p_next_attempt_at, now()), now()),
         claim_token = NULL,
         claimed_at = NULL,
         last_error_code = v_error_code,
         error_fingerprint = p_error_fingerprint,
         updated_at = now()
   WHERE id = v_row.id;
  RETURN 'retrying';
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_meta_leadgen_events(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_meta_leadgen_events(integer, integer, uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_meta_leadgen_event(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_meta_leadgen_event(uuid, uuid, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_meta_leadgen_events(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_meta_leadgen_events(integer, integer, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_meta_leadgen_event(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_meta_leadgen_event(uuid, uuid, text, text, timestamptz, boolean)
  TO service_role;
