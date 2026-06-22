-- Ensure password reset uses pgcrypto from the Supabase extensions schema.

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
