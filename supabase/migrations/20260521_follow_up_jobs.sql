-- Follow-up automático (jobs) + timeline manual CRM

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_follow_up_at timestamptz NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_scheduled_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS public.follow_up_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  agent_id text NOT NULL,
  remote_jid text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'exhausted', 'cancelled')),
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS follow_up_jobs_tenant_jid_status_idx
  ON public.follow_up_jobs (tenant_id, remote_jid, status);

CREATE INDEX IF NOT EXISTS follow_up_jobs_scheduled_pending_idx
  ON public.follow_up_jobs (scheduled_at)
  WHERE status = 'pending';

ALTER TABLE public.follow_up_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.follow_up_jobs TO service_role;

CREATE TABLE IF NOT EXISTS public.crm_follow_up_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  description text NULL,
  agent_id text NULL,
  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_follow_up_timeline_tenant_lead_idx
  ON public.crm_follow_up_timeline (tenant_id, lead_id, scheduled_at DESC);

ALTER TABLE public.crm_follow_up_timeline ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_follow_up_timeline TO service_role;
