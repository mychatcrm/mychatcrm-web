-- Plan configuration table — replaces hardcoded defaults in PlansPage
-- One row per plan slug; admin can edit limits and feature flags

CREATE TABLE IF NOT EXISTS admin_plan_config (
  plan_slug              TEXT PRIMARY KEY,
  agent_limit            INTEGER NOT NULL DEFAULT 3,
  followup_limit         INTEGER NOT NULL DEFAULT 3,
  keyword_limit          INTEGER NOT NULL DEFAULT 5,
  features               JSONB NOT NULL DEFAULT '{
    "lead_ads": true,
    "click_to_whatsapp": false,
    "qr_codes": false,
    "followup_auto": true
  }'::jsonb,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by             TEXT NULL
);

-- Default rows for Profissional and Master
INSERT INTO admin_plan_config (plan_slug, agent_limit, followup_limit, keyword_limit, features)
VALUES
  ('profissional', 3, 3, 5, '{"lead_ads":true,"click_to_whatsapp":false,"qr_codes":false,"followup_auto":true}'::jsonb),
  ('master',      30, 8, 40, '{"lead_ads":true,"click_to_whatsapp":true,"qr_codes":true,"followup_auto":true}'::jsonb)
ON CONFLICT (plan_slug) DO NOTHING;

-- Only service role can access
ALTER TABLE admin_plan_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON admin_plan_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
