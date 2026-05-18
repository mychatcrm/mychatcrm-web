-- Migration: Meta Lead Ads integration
--
-- Creates two tables:
--   meta_connections        — OAuth token per tenant+page
--   meta_form_agent_mapping — maps a Lead Ads form_id to a specific agent_id

-- ─── meta_connections ──────────────────────────────────────────────────────────
-- Stores one row per (tenant, Facebook page) after OAuth.
-- page_access_token is a long-lived page token used for Graph API calls.
-- user_access_token is kept for token refresh purposes.
CREATE TABLE IF NOT EXISTS meta_connections (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          TEXT        NOT NULL,
  page_id            TEXT        NOT NULL,
  page_name          TEXT,
  page_access_token  TEXT        NOT NULL,
  user_access_token  TEXT,
  connected_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, page_id)
);

-- ─── meta_form_agent_mapping ──────────────────────────────────────────────────
-- Maps a Lead Ads form (form_id) to a specific agent_id for automatic routing.
-- When a lead arrives from a given form, the agent set here takes priority over
-- the tenant default agent.
CREATE TABLE IF NOT EXISTS meta_form_agent_mapping (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  TEXT        NOT NULL,
  form_id    TEXT        NOT NULL,
  agent_id   TEXT        NOT NULL,
  form_name  TEXT,
  page_id    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, form_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS meta_connections_tenant_idx
  ON meta_connections (tenant_id);

CREATE INDEX IF NOT EXISTS meta_form_agent_mapping_tenant_idx
  ON meta_form_agent_mapping (tenant_id);
