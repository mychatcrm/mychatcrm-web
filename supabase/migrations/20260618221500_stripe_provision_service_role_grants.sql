-- PostgREST com JWT service_role precisa de GRANT explícito para o provisionamento de checkout.
-- Sem estes privilégios, cupons internos de teste conseguem validar, mas falham ao criar tenant/membro.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enterprise_provisions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activation_tokens TO service_role;

GRANT EXECUTE ON FUNCTION public.upsert_tenant_member(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean
) TO service_role;
