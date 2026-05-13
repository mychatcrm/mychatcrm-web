-- Migration: create leads table for CRM auto-upsert from WhatsApp inbound
-- Applied: 2026-05-11

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  name text NULL,
  phone text NULL,
  email text NULL,
  source text NULL DEFAULT 'manual',
  status text NULL DEFAULT 'novo',
  notes text NULL,
  agent_id text NULL,
  last_seen timestamptz NULL,
  last_message_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS leads_tenant_idx ON public.leads (tenant_id);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON public.leads (tenant_id, phone);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO service_role;
CREATE POLICY "tenant le seus leads" ON public.leads FOR SELECT TO authenticated USING (tenant_id = current_setting('app.tenant_id', true));
