-- Security-definer RPCs are backend-only. PostgreSQL grants EXECUTE to PUBLIC
-- for new functions by default; revoking only anon/authenticated is therefore
-- insufficient because both roles inherit PUBLIC privileges.

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

revoke all on function public.consume_password_reset_token(text, text)
  from public, anon, authenticated;
revoke all on function public.get_admin_by_email(text)
  from public, anon, authenticated;
revoke all on function public.get_admin_by_id(text)
  from public, anon, authenticated;
revoke all on function public.get_member_by_email(text)
  from public, anon, authenticated;
revoke all on function public.request_password_reset_token(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.tenant_member_email_exists(text)
  from public, anon, authenticated;
revoke all on function public.update_admin_password(text, text)
  from public, anon, authenticated;
revoke all on function public.update_member_password(text, text)
  from public, anon, authenticated;
revoke all on function public.upsert_tenant_member(
  text, text, text, text, text, text, text, text, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.verify_admin_password(text, text)
  from public, anon, authenticated;
revoke all on function public.verify_member_password(text, text)
  from public, anon, authenticated;

grant execute on function public.consume_password_reset_token(text, text) to service_role;
grant execute on function public.get_admin_by_email(text) to service_role;
grant execute on function public.get_admin_by_id(text) to service_role;
grant execute on function public.get_member_by_email(text) to service_role;
grant execute on function public.request_password_reset_token(text, text, text, timestamptz)
  to service_role;
grant execute on function public.tenant_member_email_exists(text) to service_role;
grant execute on function public.update_admin_password(text, text) to service_role;
grant execute on function public.update_member_password(text, text) to service_role;
grant execute on function public.upsert_tenant_member(
  text, text, text, text, text, text, text, text, boolean, boolean
) to service_role;
grant execute on function public.verify_admin_password(text, text) to service_role;
grant execute on function public.verify_member_password(text, text) to service_role;

-- Pin every function flagged by the database advisor. pgcrypto is installed in
-- extensions, so it remains explicit and cannot be shadowed by a caller schema.
alter function public.normalize_member_email()
  set search_path = public, extensions;
alter function public.active_offer_match_leads(
  text, text[], integer, text[], boolean, text[], boolean, integer, integer
) set search_path = public, extensions;
alter function public.update_admin_password(text, text)
  set search_path = public, extensions;
alter function public.update_member_password(text, text)
  set search_path = public, extensions;
alter function public.upsert_tenant_member(
  text, text, text, text, text, text, text, text, boolean, boolean
) set search_path = public, extensions;
alter function public.verify_admin_password(text, text)
  set search_path = public, extensions;
alter function public.verify_member_password(text, text)
  set search_path = public, extensions;
