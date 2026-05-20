-- Migration: Agent Priority System
--
-- Adds campaign tracking and organic-agent columns to support a unified
-- priority model:
--   Lead Ads campaign agent > organic slot agent > instance default > tenant fallback
--
-- Affected tables:
--   leads                       — campaign_agent_id, campaign_active, campaign_rule_id, agent_assignment_source
--   tenant_evolution_instances  — organic_agent_id

-- ─── leads ───────────────────────────────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS campaign_agent_id        text,
  ADD COLUMN IF NOT EXISTS campaign_active           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS campaign_rule_id          uuid REFERENCES lead_distribution_rules(id),
  ADD COLUMN IF NOT EXISTS agent_assignment_source   text DEFAULT 'organic';
  -- agent_assignment_source values: meta_rule | organic_slot | manual | return_automation

-- Partial index for fast lookup of leads with an active campaign
CREATE INDEX IF NOT EXISTS idx_leads_campaign_active
  ON leads(tenant_id, campaign_active)
  WHERE campaign_active = true;

-- ─── tenant_evolution_instances ───────────────────────────────────────────────

ALTER TABLE tenant_evolution_instances
  ADD COLUMN IF NOT EXISTS organic_agent_id text;

-- Data migration: seed organic_agent_id from existing default_agent_id so that
-- slots already configured keep working without re-configuration.
UPDATE tenant_evolution_instances
  SET organic_agent_id = default_agent_id
  WHERE default_agent_id IS NOT NULL
    AND organic_agent_id IS NULL;
