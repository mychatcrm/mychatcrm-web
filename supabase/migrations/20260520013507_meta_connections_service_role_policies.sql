DROP POLICY IF EXISTS "meta_connections_service_role_full_access" ON public.meta_connections;
CREATE POLICY "meta_connections_service_role_full_access"
  ON public.meta_connections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "meta_form_agent_mapping_service_role_full_access" ON public.meta_form_agent_mapping;
CREATE POLICY "meta_form_agent_mapping_service_role_full_access"
  ON public.meta_form_agent_mapping
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_form_agent_mapping TO service_role;
