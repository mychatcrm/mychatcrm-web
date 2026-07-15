-- Outbox durável para notificações de agendamento ao telefone do tenant.
-- Cada mutação real de agenda (criada/remarcada/cancelada) enfileira UMA linha
-- com chave idempotente (tenant + operation_key + action); o envio acontece
-- inline após a mutação e um cron reprocessa pendências/falhas com retry
-- controlado. Reversível com: DROP TABLE public.agenda_notification_outbox;

CREATE TABLE IF NOT EXISTS public.agenda_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  agenda_event_id uuid NULL REFERENCES public.agenda_events(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('scheduled', 'rescheduled', 'cancelled')),
  operation_key text NOT NULL,
  phone_last4 text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_key, action)
);

CREATE INDEX IF NOT EXISTS agenda_notification_outbox_pending_idx
  ON public.agenda_notification_outbox (status, updated_at)
  WHERE status = 'pending';

ALTER TABLE public.agenda_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_notification_outbox FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agenda_notification_outbox TO service_role;

NOTIFY pgrst, 'reload schema';
