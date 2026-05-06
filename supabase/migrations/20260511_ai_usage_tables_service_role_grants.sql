-- Privilégios explícitos para service_role (PostgREST com JWT service_role).
-- Complementa 20260510_admin_platform_openai_privileges.sql nas tabelas de tracking IA.

GRANT ALL ON TABLE public.ai_usage_logs TO service_role;
GRANT ALL ON TABLE public.ai_usage_limits TO service_role;
GRANT ALL ON TABLE public.ai_usage_daily TO service_role;
GRANT ALL ON TABLE public.ai_usage_alerts TO service_role;
GRANT ALL ON TABLE public.ai_model_pricing TO service_role;
