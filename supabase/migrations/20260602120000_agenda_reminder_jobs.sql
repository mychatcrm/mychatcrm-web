-- Lembretes de agendamento (pipeline separado do follow-up convencional)
CREATE TABLE IF NOT EXISTS agenda_reminder_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  agent_id text NOT NULL,
  agenda_event_id uuid NOT NULL REFERENCES agenda_events(id) ON DELETE CASCADE,
  remote_jid text NOT NULL,
  lead_id uuid NULL REFERENCES leads(id) ON DELETE SET NULL,
  scheduled_at timestamptz NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  offset_minutes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_reminder_jobs_status_check CHECK (
    status IN ('pending', 'sent', 'cancelled', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS agenda_reminder_jobs_due_idx
  ON agenda_reminder_jobs (tenant_id, status, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS agenda_reminder_jobs_event_idx
  ON agenda_reminder_jobs (agenda_event_id);

ALTER TABLE agenda_reminder_jobs ENABLE ROW LEVEL SECURITY;

GRANT ALL ON agenda_reminder_jobs TO service_role;
