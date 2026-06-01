-- Lookup de contexto de agenda por tenant, telefone e data.

CREATE INDEX IF NOT EXISTS agenda_events_tenant_phone_start_active_idx
  ON public.agenda_events (tenant_id, attendee_phone, start_at)
  WHERE attendee_phone IS NOT NULL AND status <> 'cancelled';
