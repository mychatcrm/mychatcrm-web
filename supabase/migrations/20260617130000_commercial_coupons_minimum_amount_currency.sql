-- Moeda do valor mínimo por pedido (Stripe restrictions.minimum_amount_currency).
ALTER TABLE public.commercial_coupons
  ADD COLUMN IF NOT EXISTS minimum_amount_currency TEXT DEFAULT 'brl';

COMMENT ON COLUMN public.commercial_coupons.minimum_amount_brl IS
  'Valor mínimo em menor unidade da moeda (Stripe minimum_amount). Coluna legada; não limitada a BRL.';
COMMENT ON COLUMN public.commercial_coupons.minimum_amount_currency IS
  'Moeda ISO do valor mínimo (Stripe minimum_amount_currency).';
