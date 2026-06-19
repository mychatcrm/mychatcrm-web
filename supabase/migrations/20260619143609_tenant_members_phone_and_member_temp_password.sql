-- Checkout owner phone + member temporary password recovery.
-- Non-destructive: existing members keep phone as NULL.

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.tenant_members.phone IS
  'Normalized checkout phone/WhatsApp for the tenant owner/member. Digits only; email remains the login identifier.';

CREATE INDEX IF NOT EXISTS idx_tenant_members_phone
  ON public.tenant_members (phone)
  WHERE phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_member_temporary_password(
  p_email text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id text;
BEGIN
  IF length(trim(p_new_password)) < 8 THEN
    RETURN jsonb_build_object('found', false, 'code', 'weak_password');
  END IF;

  UPDATE public.tenant_members
  SET password_hash = crypt(p_new_password, gen_salt('bf', 12)),
      password_changed_at = now(),
      updated_at = now()
  WHERE email = lower(trim(p_email))
    AND ativo = true
    AND account_suspended = false
  RETURNING id INTO v_member_id;

  IF v_member_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  DELETE FROM public.password_reset_tokens
  WHERE lower(trim(email)) = lower(trim(p_email))
    AND scope = 'member'
    AND used_at IS NULL;

  RETURN jsonb_build_object('found', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_temporary_password(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_member_temporary_password(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_temporary_password(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
