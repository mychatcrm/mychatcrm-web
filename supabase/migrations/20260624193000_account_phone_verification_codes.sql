CREATE TABLE IF NOT EXISTS public.account_phone_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  member_id text,
  phone_type text NOT NULL CHECK (phone_type IN ('personal', 'system_notification')),
  phone text NOT NULL,
  code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'consumed', 'expired', 'failed', 'locked', 'superseded')),
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.account_phone_verification_codes IS
  'Códigos de uso único para confirmar telefones de conta e telefones de notificações do sistema.';

CREATE INDEX IF NOT EXISTS idx_account_phone_verification_lookup
  ON public.account_phone_verification_codes (tenant_id, member_id, phone_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_phone_verification_phone_recent
  ON public.account_phone_verification_codes (phone, phone_type, created_at DESC);

ALTER TABLE public.account_phone_verification_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "account_phone_verification_service_role_all"
    ON public.account_phone_verification_codes
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_phone_verification_codes TO service_role;

NOTIFY pgrst, 'reload schema';
