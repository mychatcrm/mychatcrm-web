-- Permite apagar leads capturados pelo popup de pré-lançamento
-- (/admin/leads-lancamento) — a migration original só concedia
-- select/insert/update, sem delete.

grant delete on table public.pre_launch_leads to service_role;
