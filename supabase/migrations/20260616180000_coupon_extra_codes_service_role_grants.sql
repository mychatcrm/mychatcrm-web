-- PostgREST com JWT service_role precisa de GRANT explícito (padrão commercial_coupons / coupon_redemptions).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.coupon_extra_codes TO service_role;
