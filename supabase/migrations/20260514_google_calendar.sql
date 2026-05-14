-- Google Calendar OAuth tokens + agenda events (multi-tenant)

CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL UNIQUE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  email text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_calendar_tokens TO service_role;

CREATE TABLE IF NOT EXISTS public.agenda_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  google_event_id text NULL,
  title text NOT NULL,
  description text NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  attendee_name text NULL,
  attendee_phone text NULL,
  attendee_email text NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'pending')),
  created_by text NOT NULL DEFAULT 'system' CHECK (created_by IN ('system', 'user', 'agent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agenda_events_tenant_start_idx
  ON public.agenda_events (tenant_id, start_at);

CREATE UNIQUE INDEX IF NOT EXISTS agenda_events_tenant_google_event_uidx
  ON public.agenda_events (tenant_id, google_event_id)
  WHERE google_event_id IS NOT NULL;

ALTER TABLE public.agenda_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agenda_events TO service_role;
