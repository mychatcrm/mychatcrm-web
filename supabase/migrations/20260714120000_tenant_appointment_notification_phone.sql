ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS appointment_notification_phone text;

COMMENT ON COLUMN public.tenants.appointment_notification_phone IS
  'Telefone/WhatsApp que recebe avisos quando o agente de IA cria, remarca ou cancela um agendamento. Dígitos normalizados; não é linha de atendimento.';

CREATE INDEX IF NOT EXISTS idx_tenants_appointment_notification_phone
  ON public.tenants (appointment_notification_phone)
  WHERE appointment_notification_phone IS NOT NULL;

ALTER TABLE public.account_phone_verification_codes
  DROP CONSTRAINT IF EXISTS account_phone_verification_codes_phone_type_check;

ALTER TABLE public.account_phone_verification_codes
  ADD CONSTRAINT account_phone_verification_codes_phone_type_check
  CHECK (phone_type IN ('personal', 'system_notification', 'appointment_notification'));

NOTIFY pgrst, 'reload schema';
