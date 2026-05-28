-- CTA scheduling: link agenda events to lead/agent + index for active dedupe

ALTER TABLE public.agenda_events
  ADD COLUMN IF NOT EXISTS lead_id uuid NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_id text NULL;

CREATE INDEX IF NOT EXISTS agenda_events_agent_phone_active_idx
  ON public.agenda_events (tenant_id, attendee_phone, status)
  WHERE created_by = 'agent' AND status <> 'cancelled';
