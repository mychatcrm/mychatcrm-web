-- GRANTs explícitos para service_role (padrão das outras tabelas internas).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_form_agent_mapping TO service_role;
