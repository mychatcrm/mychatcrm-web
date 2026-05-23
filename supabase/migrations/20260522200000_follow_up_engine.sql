-- Follow-up engine v2: observability events + enhanced job columns + lead status fields

-- ─── agent_followup_events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_followup_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  agent_id      text        NOT NULL,
  remote_jid    text        NOT NULL,
  lead_id       uuid        NULL,
  job_id        uuid        NULL,
  event_type    text        NOT NULL CHECK (event_type IN (
    'follow_up_evaluated',
    'follow_up_skipped',
    'follow_up_blocked_by_human',
    'follow_up_sent',
    'follow_up_failed',
    'cooldown_active',
    'spam_risk_detected',
    'sla_breached',
    'follow_up_closed',
    'business_hours_skipped',
    'customer_replied',
    'follow_up_exhausted'
  )),
  payload       jsonb       NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_followup_events_tenant_jid_idx
  ON public.agent_followup_events (tenant_id, remote_jid, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_followup_events_tenant_type_idx
  ON public.agent_followup_events (tenant_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_followup_events_lead_idx
  ON public.agent_followup_events (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

ALTER TABLE public.agent_followup_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON TABLE public.agent_followup_events TO service_role;

-- ─── Enhance follow_up_jobs ───────────────────────────────────────────────────
ALTER TABLE public.follow_up_jobs ADD COLUMN IF NOT EXISTS lead_id        uuid        NULL;
ALTER TABLE public.follow_up_jobs ADD COLUMN IF NOT EXISTS follow_up_type text        NOT NULL DEFAULT 'silence';
ALTER TABLE public.follow_up_jobs ADD COLUMN IF NOT EXISTS priority       integer     NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5);
ALTER TABLE public.follow_up_jobs ADD COLUMN IF NOT EXISTS context_summary text       NULL;

-- ─── Enhance leads ────────────────────────────────────────────────────────────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_status         text        NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_blocked_reason text        NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_cooldown_until timestamptz NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sla_breached_at          timestamptz NULL;
