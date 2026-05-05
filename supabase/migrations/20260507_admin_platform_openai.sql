-- Platform OpenAI API key (ciphertext only; decrypted only on server with PLATFORM_OPENAI_KEY_SECRET)

CREATE TABLE IF NOT EXISTS admin_platform_openai (
  id                         TEXT PRIMARY KEY DEFAULT 'global',
  openai_api_key_ciphertext  TEXT,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO admin_platform_openai (id, openai_api_key_ciphertext)
VALUES ('global', NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE admin_platform_openai ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON admin_platform_openai
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
