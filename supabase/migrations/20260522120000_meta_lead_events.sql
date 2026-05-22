-- Meta Lead Ads: inbox de eventos para /integracoes-leads (tempo real + status do pipeline)

CREATE TABLE IF NOT EXISTS public.meta_lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  leadgen_id text NOT NULL,
  page_id text NOT NULL,
  form_id text NULL,
  ad_id text NULL,
  adset_id text NULL,
  lead_id uuid NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  name text NULL,
  phone text NULL,
  email text NULL,
  form_name text NULL,
  page_name text NULL,
  campaign_id text NULL,
  campaign_name text NULL,
  adset_name text NULL,
  ad_name text NULL,
  agent_id text NULL,
  agent_resolution_source text NULL,
  crm_sync_status text NOT NULL DEFAULT 'pending',
  whatsapp_status text NOT NULL DEFAULT 'pending',
  current_step text NOT NULL DEFAULT 'lead_received',
  steps_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  form_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_webhook jsonb NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, leadgen_id)
);

CREATE INDEX IF NOT EXISTS meta_lead_events_tenant_created_idx
  ON public.meta_lead_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meta_lead_events_tenant_step_idx
  ON public.meta_lead_events (tenant_id, current_step);

ALTER TABLE public.meta_lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_lead_events_tenant_select" ON public.meta_lead_events;
CREATE POLICY "meta_lead_events_tenant_select" ON public.meta_lead_events
  FOR SELECT TO authenticated
  USING (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_lead_events TO service_role;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_lead_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
