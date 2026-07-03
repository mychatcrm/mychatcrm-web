-- WhatsApp Cloud API connections per tenant (Embedded Signup / Meta Official API)
-- Completely separate from the Evolution QR Code flow.

CREATE TABLE public.whatsapp_cloud_connections (
  id              UUID         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       TEXT         NOT NULL,
  phone_number_id TEXT         NOT NULL,
  waba_id         TEXT,
  access_token    TEXT         NOT NULL,
  display_phone   TEXT,
  verified_name   TEXT,
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  connected_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_cloud_connections_pkey         PRIMARY KEY (id),
  CONSTRAINT whatsapp_cloud_connections_phone_uniq   UNIQUE (phone_number_id)
);

ALTER TABLE public.whatsapp_cloud_connections ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_cloud_connections TO service_role;
