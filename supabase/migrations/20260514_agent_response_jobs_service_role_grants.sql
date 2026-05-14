-- service_role precisa de CRUD explícito (migration original só habilitou RLS)
grant select, insert, update, delete on table public.agent_response_jobs to service_role;
