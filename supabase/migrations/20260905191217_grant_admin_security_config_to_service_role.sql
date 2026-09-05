-- The table intentionally has no browser access. Its original migration added
-- an RLS policy for service_role but omitted the underlying table privileges,
-- so the authenticated admin API still received `permission denied`.
revoke all on table public.admin_security_config from public, anon, authenticated;

grant select, insert, update on table public.admin_security_config to service_role;
