-- Admin security configuration table for persisting toggles
-- Replaces the mock toggles in SecurityPage

CREATE TABLE IF NOT EXISTS admin_security_config (
  id                    TEXT PRIMARY KEY DEFAULT 'global',
  ip_whitelist_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  block_off_hours       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default row so GET always returns something
INSERT INTO admin_security_config (id, ip_whitelist_enabled, block_off_hours)
VALUES ('global', FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Only service role can access this table
ALTER TABLE admin_security_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON admin_security_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
