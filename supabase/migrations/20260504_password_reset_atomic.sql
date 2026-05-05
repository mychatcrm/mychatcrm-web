-- Migration: Password Reset Atomic Functions
-- Applied: 2026-05-04
-- Purpose: Atomic SECURITY DEFINER functions to eliminate RLS bypass issues
--          and close the race-condition window in token consumption.

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_password_reset_expires_at
  ON public.password_reset_tokens (expires_at);

-- ── request_password_reset_token ─────────────────────────────────────────────
-- Looks up the user, invalidates pending tokens, inserts the new hashed token.
-- Runs as a single transaction (plpgsql); SECURITY DEFINER bypasses RLS.
-- Returns: {found: false} when no active account matches — caller must NOT
--          expose this to the end user (anti-enumeration).

CREATE OR REPLACE FUNCTION public.request_password_reset_token(
  p_email      text,
  p_scope      text,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject_id text;
BEGIN
  IF p_scope = 'admin' THEN
    SELECT id INTO v_subject_id
    FROM public.admin_users
    WHERE email = lower(trim(p_email))
      AND active = true
    LIMIT 1;
  ELSE
    SELECT id INTO v_subject_id
    FROM public.tenant_members
    WHERE email = lower(trim(p_email))
      AND ativo = true
      AND account_suspended = false
    LIMIT 1;
  END IF;

  IF v_subject_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Invalidate all pending tokens for (email, scope) before issuing new one
  DELETE FROM public.password_reset_tokens
  WHERE lower(trim(email)) = lower(trim(p_email))
    AND scope = p_scope
    AND used_at IS NULL;

  INSERT INTO public.password_reset_tokens (token_hash, scope, subject_id, email, expires_at)
  VALUES (p_token_hash, p_scope, v_subject_id, lower(trim(p_email)), p_expires_at);

  RETURN jsonb_build_object('found', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_password_reset_token(text, text, text, timestamptz)
  TO service_role, authenticated, anon;

-- ── consume_password_reset_token ─────────────────────────────────────────────
-- FOR UPDATE lock → validate used_at + expires_at → update password → mark used.
-- Single transaction: eliminates the two-step TypeScript race/replay window.
-- Returns: {code: 'ok'|'invalid_token'|'expired'|'already_used'|'weak_password'}

CREATE OR REPLACE FUNCTION public.consume_password_reset_token(
  p_token_hash   text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.password_reset_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.password_reset_tokens
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'invalid_token');
  END IF;

  IF v_row.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'already_used');
  END IF;

  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('code', 'expired');
  END IF;

  IF length(trim(p_new_password)) < 8 THEN
    RETURN jsonb_build_object('code', 'weak_password');
  END IF;

  IF v_row.scope = 'admin' THEN
    UPDATE public.admin_users
    SET password_hash = crypt(p_new_password, gen_salt('bf', 12)),
        updated_at    = now()
    WHERE id = v_row.subject_id;
  ELSE
    UPDATE public.tenant_members
    SET password_hash = crypt(p_new_password, gen_salt('bf', 12)),
        updated_at    = now()
    WHERE id = v_row.subject_id;
  END IF;

  UPDATE public.password_reset_tokens
  SET used_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object('code', 'ok');
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_password_reset_token(text, text)
  TO service_role, authenticated, anon;

-- ── Session invalidation after password reset ────────────────────────────────
-- Stamps the moment a password was changed so the app can reject stale cookies.

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz DEFAULT now();

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz DEFAULT now();

-- Initialise existing rows to now() so they are not immediately invalidated.
UPDATE public.admin_users   SET password_changed_at = now() WHERE password_changed_at IS NULL;
UPDATE public.tenant_members SET password_changed_at = now() WHERE password_changed_at IS NULL;

-- ── Cleanup (run manually or via pg_cron) ────────────────────────────────────
-- Removes tokens expired more than 7 days ago to keep the table lean.
-- Example pg_cron schedule (add in Supabase Dashboard → Database → Cron Jobs):
--   SELECT cron.schedule('cleanup-password-reset-tokens', '0 3 * * *',
--     $$DELETE FROM public.password_reset_tokens WHERE expires_at < now() - interval '7 days'$$);
