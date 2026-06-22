-- Preserve valid password reset links during repeated requests.
--
-- Previous behavior deleted every pending token for the same email/scope before
-- sending a new email. If a user clicked an older email after a second request
-- was generated, the link was already gone and appeared as "invalid/expired".
--
-- New behavior:
-- 1. New requests keep still-valid, unused links alive until their normal
--    30-minute expiry. Rate limits still cap abuse at the API layer.
-- 2. Once any valid link is used successfully, all pending links for the same
--    email/scope are marked used in the same transaction.

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

  -- Keep valid links usable. Clean only expired, unused links for this account.
  DELETE FROM public.password_reset_tokens
  WHERE lower(trim(email)) = lower(trim(p_email))
    AND scope = p_scope
    AND used_at IS NULL
    AND expires_at <= now();

  INSERT INTO public.password_reset_tokens (token_hash, scope, subject_id, email, expires_at)
  VALUES (p_token_hash, p_scope, v_subject_id, lower(trim(p_email)), p_expires_at);

  RETURN jsonb_build_object('found', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_password_reset_token(text, text, text, timestamptz)
  TO service_role, authenticated, anon;

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
  v_now timestamptz := now();
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

  IF v_row.expires_at <= v_now THEN
    RETURN jsonb_build_object('code', 'expired');
  END IF;

  IF length(trim(p_new_password)) < 8 THEN
    RETURN jsonb_build_object('code', 'weak_password');
  END IF;

  IF v_row.scope = 'admin' THEN
    UPDATE public.admin_users
    SET password_hash       = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
        password_changed_at = v_now,
        updated_at          = v_now
    WHERE id = v_row.subject_id;
  ELSE
    UPDATE public.tenant_members
    SET password_hash       = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
        password_changed_at = v_now,
        updated_at          = v_now
    WHERE id = v_row.subject_id;
  END IF;

  -- Using one link invalidates every other pending link for the same account.
  UPDATE public.password_reset_tokens
  SET used_at = v_now
  WHERE lower(trim(email)) = lower(trim(v_row.email))
    AND scope = v_row.scope
    AND used_at IS NULL;

  RETURN jsonb_build_object('code', 'ok');
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_password_reset_token(text, text)
  TO service_role, authenticated, anon;
