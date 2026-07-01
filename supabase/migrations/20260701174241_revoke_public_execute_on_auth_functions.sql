-- Fecha takeover de conta sem autenticação: estas SECURITY DEFINER functions só são
-- chamadas pelo app via service_role (lib/server/admin-auth-db.ts, team-employees-db.ts,
-- stripe-provision.ts). Estavam com EXECUTE liberado para anon/authenticated por padrão
-- do Postgres, permitindo chamar update_admin_password/update_member_password direto via
-- PostgREST (/rest/v1/rpc/...) com a chave anon pública, sem qualquer verificação de senha.
REVOKE EXECUTE ON FUNCTION public.update_admin_password(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_member_password(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_member_password(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_tenant_member(text, text, text, text, text, text, text, text, boolean, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_by_email(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_by_id(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_member_by_email(text) FROM anon, authenticated;
