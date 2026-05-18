-- Migration: dedup inbound webhook replays via UNIQUE (tenant_id, message_id)
--
-- Problem: Evolution API retries webhooks if it doesn't get a timely 200 OK.
-- The same message_id arrives a second time, saveMessage() does a plain INSERT,
-- and a second agent_response_job is created → the customer receives two replies.
--
-- Fix: add a partial UNIQUE index on (tenant_id, message_id) WHERE message_id IS NOT NULL.
-- outbound messages have no message_id (NULL) and are excluded from the constraint.
--
-- Application layer (saveMessage) will be updated to use
--   INSERT ... ON CONFLICT (tenant_id, message_id) DO NOTHING RETURNING *
-- so duplicates silently return NULL and the automation flow is skipped.

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_tenant_message_id_uidx
  ON whatsapp_messages (tenant_id, message_id)
  WHERE message_id IS NOT NULL;
