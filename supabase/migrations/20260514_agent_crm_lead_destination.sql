-- Agent-level CRM lead destination.
-- Safe defaults preserve current behavior for existing agents and leads.

ALTER TABLE public.tenant_agents
  ADD COLUMN IF NOT EXISTS crm_auto_move_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crm_target_funnel_id text NULL,
  ADD COLUMN IF NOT EXISTS crm_target_column_id text NULL,
  ADD COLUMN IF NOT EXISTS crm_target_status text NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS crm_funnel_id text NULL DEFAULT 'funil-default';

CREATE INDEX IF NOT EXISTS tenant_agents_crm_destination_idx
  ON public.tenant_agents (tenant_id, agent_id, crm_auto_move_enabled);

CREATE INDEX IF NOT EXISTS leads_tenant_crm_funnel_status_idx
  ON public.leads (tenant_id, crm_funnel_id, status);
