-- Políticas RLS explícitas para o papel service_role nas tabelas de tracking de IA.
-- Complementa RLS já activo: garante acesso quando a ligação usa o JWT service_role (PostgREST).

DROP POLICY IF EXISTS "service_role_full_access" ON public.ai_usage_logs;
CREATE POLICY "service_role_full_access" ON public.ai_usage_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.ai_usage_daily;
CREATE POLICY "service_role_full_access" ON public.ai_usage_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.ai_usage_alerts;
CREATE POLICY "service_role_full_access" ON public.ai_usage_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.ai_usage_limits;
CREATE POLICY "service_role_full_access" ON public.ai_usage_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.ai_model_pricing;
CREATE POLICY "service_role_full_access" ON public.ai_model_pricing
  FOR ALL TO service_role USING (true) WITH CHECK (true);
