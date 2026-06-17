-- Limites e validade do código principal (Stripe Promotion Code).
ALTER TABLE public.commercial_coupons
  ADD COLUMN IF NOT EXISTS promo_max_redemptions INTEGER,
  ADD COLUMN IF NOT EXISTS promo_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.commercial_coupons.promo_max_redemptions IS
  'max_redemptions do Promotion Code principal no Stripe.';
COMMENT ON COLUMN public.commercial_coupons.promo_expires_at IS
  'expires_at do Promotion Code principal no Stripe.';
