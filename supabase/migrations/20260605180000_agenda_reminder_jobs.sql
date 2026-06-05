-- Tabela de jobs de lembrete para agendamentos via agente.
-- Cada registro representa um lembrete a ser enviado via WhatsApp antes do evento.

CREATE TABLE IF NOT EXISTS public.agenda_reminder_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  agent_id        text,
  slot_index      integer     NOT NULL DEFAULT 0,
  remote_jid      text        NOT NULL,
  agenda_event_id uuid        NOT NULL,
  scheduled_at    timestamptz NOT NULL,
  message         text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','sent','failed','cancelled')),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Índice primário de processamento: busca jobs pendentes por data
CREATE INDEX IF NOT EXISTS agenda_reminder_jobs_scheduled_idx
  ON public.agenda_reminder_jobs (tenant_id, scheduled_at)
  WHERE status = 'pending';

-- Índice para cancelar todos os jobs de um evento (ao cancelar agendamento)
CREATE INDEX IF NOT EXISTS agenda_reminder_jobs_event_idx
  ON public.agenda_reminder_jobs (agenda_event_id);

-- Sem RLS: acesso exclusivo via service_role no backend
