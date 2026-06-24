ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS system_notification_phone text;

COMMENT ON COLUMN public.tenants.system_notification_phone IS
  'Telefone/WhatsApp administrativo para alertas operacionais do sistema, como conexões WhatsApp ou Meta conectadas/desconectadas. Dígitos normalizados; não é linha de atendimento.';

CREATE INDEX IF NOT EXISTS idx_tenants_system_notification_phone
  ON public.tenants (system_notification_phone)
  WHERE system_notification_phone IS NOT NULL;

NOTIFY pgrst, 'reload schema';
