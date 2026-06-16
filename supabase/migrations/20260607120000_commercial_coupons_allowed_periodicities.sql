-- Restrição opcional de periodicidade (mensal/anual) em cupons comerciais.
ALTER TABLE public.commercial_coupons
  ADD COLUMN IF NOT EXISTS allowed_periodicities text[] NOT NULL DEFAULT '{}';
