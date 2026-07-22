-- Low-latency inbox invalidation without exposing whatsapp_messages to browsers.
-- The public Broadcast topic is an unguessable capability and carries only a
-- message UUID. Message content is hydrated through the authenticated app API.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.inbox_realtime_topics (
  tenant_id text PRIMARY KEY,
  topic_token text NOT NULL UNIQUE
    DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NULL
);

ALTER TABLE private.inbox_realtime_topics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.inbox_realtime_topics FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON private.inbox_realtime_topics TO service_role;

CREATE OR REPLACE FUNCTION public.get_or_create_inbox_realtime_topic(
  p_tenant_id text
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private, extensions
AS $$
DECLARE
  v_topic text;
BEGIN
  IF NULLIF(btrim(p_tenant_id), '') IS NULL THEN
    RAISE EXCEPTION 'tenant_id_required';
  END IF;

  INSERT INTO private.inbox_realtime_topics (tenant_id)
  VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT topic_token INTO STRICT v_topic
    FROM private.inbox_realtime_topics
   WHERE tenant_id = p_tenant_id;

  RETURN 'inbox:' || v_topic;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_inbox_realtime_topic(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_inbox_realtime_topic(text)
  TO service_role;

CREATE OR REPLACE FUNCTION private.broadcast_whatsapp_message_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, realtime, extensions
AS $$
DECLARE
  v_topic text;
BEGIN
  BEGIN
    INSERT INTO private.inbox_realtime_topics (tenant_id)
    VALUES (NEW.tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;

    SELECT topic_token INTO STRICT v_topic
      FROM private.inbox_realtime_topics
     WHERE tenant_id = NEW.tenant_id;

    PERFORM realtime.send(
      jsonb_build_object(
        'messageId', NEW.id::text,
        'operation', lower(TG_OP)
      ),
      'message_changed',
      'inbox:' || v_topic,
      false
    );
  EXCEPTION WHEN OTHERS THEN
    -- Realtime is best-effort. It must never roll back message persistence,
    -- agent processing, agenda operations, or provider delivery receipts.
    RAISE WARNING 'inbox realtime broadcast failed for message %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.broadcast_whatsapp_message_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS whatsapp_messages_inbox_broadcast
  ON public.whatsapp_messages;
CREATE TRIGGER whatsapp_messages_inbox_broadcast
AFTER INSERT OR UPDATE OF
  content,
  media_url,
  delivery_status,
  provider_status,
  transcription_status,
  analysis_status,
  agent_id
ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION private.broadcast_whatsapp_message_change();

-- This policy existed remotely without a matching table grant. Granting SELECT
-- would expose every tenant, so remove the latent unsafe path instead.
DROP POLICY IF EXISTS "anon realtime read" ON public.whatsapp_messages;
