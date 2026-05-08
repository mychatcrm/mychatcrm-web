-- Grants para service_role (usado pelos server routes via createSupabaseServiceClient)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_agents TO service_role;

-- RLS policies para clientes autenticados
CREATE POLICY "tenant pode ler seus agentes"
ON public.tenant_agents FOR SELECT
TO authenticated
USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY "tenant pode inserir seus agentes"
ON public.tenant_agents FOR INSERT
TO authenticated
WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY "tenant pode atualizar seus agentes"
ON public.tenant_agents FOR UPDATE
TO authenticated
USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY "tenant pode apagar seus agentes"
ON public.tenant_agents FOR DELETE
TO authenticated
USING (tenant_id = current_setting('app.tenant_id', true));

-- Coluna metadata para persistir o objeto Agent completo (fluxo, funil, origens, etc.)
ALTER TABLE public.tenant_agents
  ADD COLUMN IF NOT EXISTS metadata JSONB NULL DEFAULT NULL;
