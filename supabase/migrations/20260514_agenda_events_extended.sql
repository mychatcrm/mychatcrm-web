-- Campos extras para paridade com Google Agenda + Realtime

ALTER TABLE public.agenda_events
  ADD COLUMN IF NOT EXISTS location text NULL,
  ADD COLUMN IF NOT EXISTS color text NULL DEFAULT '#f24400';

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agenda_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
