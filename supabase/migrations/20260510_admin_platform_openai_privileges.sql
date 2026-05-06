-- Garantir privilégios de escrita para o papel usado pelo PostgREST com JWT service_role.
-- Evita 42501 em ambientes onde a tabela ficou sem GRANT explícito após CREATE.

GRANT ALL ON TABLE public.admin_platform_openai TO service_role;
