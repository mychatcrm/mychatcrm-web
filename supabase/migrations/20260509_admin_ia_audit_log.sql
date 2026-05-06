-- Auditoria de acções sensíveis no hub /admin/ia (OmniChat — credenciais e testes de ligação).
create table if not exists public.admin_ia_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_ia_audit_log_created_idx
  on public.admin_ia_audit_log (created_at desc);

create index if not exists admin_ia_audit_log_admin_idx
  on public.admin_ia_audit_log (admin_id, created_at desc);

comment on table public.admin_ia_audit_log is 'Auditoria admin: alterações de credenciais OpenAI da plataforma e testes de ligação.';

alter table public.admin_ia_audit_log enable row level security;

drop policy if exists "service_role_full_access" on public.admin_ia_audit_log;
create policy "service_role_full_access" on public.admin_ia_audit_log
  for all to service_role using (true) with check (true);

grant all on table public.admin_ia_audit_log to service_role;
