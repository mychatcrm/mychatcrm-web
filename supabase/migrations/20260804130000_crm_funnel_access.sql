-- Acesso a funil por colaborador.
--
-- Fase 2 do acesso por funil. Regra confirmada com o operador: liberar funis
-- NÃO amplia o que o vendedor enxerga — ele continua vendo apenas os leads
-- atribuídos a ele. A liberação apenas restringe em quais funis ele trabalha.
--
-- Sem nenhuma linha aqui para um colaborador, o comportamento é o de hoje
-- (todos os leads dele, em qualquer funil). Isso é deliberado: o deploy não
-- pode esconder os leads de ninguém até o titular configurar.

create table if not exists public.crm_funnel_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  employee_id text not null references public.tenant_members(id) on delete cascade,
  -- Id lógico do funil (`crm_funnels.funnel_id`), não a PK uuid.
  funnel_id text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, employee_id, funnel_id)
);

create index if not exists crm_funnel_access_tenant_employee_idx
  on public.crm_funnel_access (tenant_id, employee_id);

alter table public.crm_funnel_access enable row level security;

drop policy if exists "tenant_isolation" on public.crm_funnel_access;
create policy "tenant_isolation" on public.crm_funnel_access
  using (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update, delete on table public.crm_funnel_access to service_role;

comment on table public.crm_funnel_access is
  'Funis liberados por colaborador. Nenhuma linha = sem restrição por funil (comportamento anterior). Com linhas = o colaborador só alcança os leads dele nesses funis.';
