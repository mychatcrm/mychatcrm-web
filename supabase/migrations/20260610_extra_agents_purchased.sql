-- Adiciona contador de agentes extras comprados via Stripe.
-- Coluna persiste entre renovações de assinatura; reseta só se removida manualmente.
ALTER TABLE stripe_subscriptions
  ADD COLUMN IF NOT EXISTS extra_agents_purchased int4 NOT NULL DEFAULT 0;
