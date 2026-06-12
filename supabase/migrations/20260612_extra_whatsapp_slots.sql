ALTER TABLE stripe_subscriptions
  ADD COLUMN IF NOT EXISTS extra_whatsapp_slots int4 NOT NULL DEFAULT 0;
