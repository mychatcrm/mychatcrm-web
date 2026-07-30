-- Equipes: isolamento de dados por equipe (Diretor N equipes, Gerente/Vendedor 1 equipe).
--
-- Fase 1 do plano de equipes: cria a estrutura e as colunas de escopo, sem
-- alterar nenhum comportamento de leitura ainda. O enforcement server-side
-- entra na Fase 2 (lib/server/access-scope.ts).

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists teams_tenant_idx
  on public.teams (tenant_id, active, name);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  employee_id text not null references public.tenant_members(id) on delete cascade,
  role_in_team text not null check (role_in_team in ('director', 'manager', 'seller')),
  created_at timestamptz not null default now(),
  unique (team_id, employee_id)
);

create index if not exists team_members_tenant_team_idx
  on public.team_members (tenant_id, team_id);

create index if not exists team_members_tenant_employee_idx
  on public.team_members (tenant_id, employee_id);

-- Diretor pode estar em N equipes; gerente e vendedor em NO MÁXIMO UMA.
-- O índice parcial é o que garante a regra no banco, não só na aplicação.
create unique index if not exists team_members_one_team_for_manager_seller
  on public.team_members (employee_id)
  where role_in_team in ('manager', 'seller');

-- ── Colunas de escopo (denormalizadas para indexar sem join) ────────────────

alter table public.leads
  add column if not exists team_id uuid null references public.teams(id) on delete set null;

create index if not exists leads_tenant_team_idx
  on public.leads (tenant_id, team_id);

alter table public.conversation_states
  add column if not exists team_id uuid null references public.teams(id) on delete set null;

create index if not exists conversation_states_tenant_team_idx
  on public.conversation_states (tenant_id, team_id);

alter table public.agenda_events
  add column if not exists team_id uuid null references public.teams(id) on delete set null,
  add column if not exists owner_employee_id text null;

create index if not exists agenda_events_tenant_team_idx
  on public.agenda_events (tenant_id, team_id);

create index if not exists agenda_events_tenant_owner_idx
  on public.agenda_events (tenant_id, owner_employee_id);

-- Carimbo de origem: todo lead que entra por uma regra herda a equipe dela.
alter table public.lead_distribution_rules
  add column if not exists team_id uuid null references public.teams(id) on delete set null;

create index if not exists lead_distribution_rules_tenant_team_idx
  on public.lead_distribution_rules (tenant_id, team_id);

-- ── Titular da conta explícito ──────────────────────────────────────────────
-- Substitui a heurística "só Enterprise com ownerEmployeeId vira owner", que
-- deixava o titular de Equipa/Escala sem poder gerir a própria equipe.

alter table public.tenant_members
  add column if not exists is_owner boolean not null default false;

create unique index if not exists tenant_members_single_owner_per_tenant
  on public.tenant_members (tenant_id)
  where is_owner;

-- Backfill: o membro sem superior mais antigo de cada tenant é o titular.
with ranked as (
  select
    id,
    row_number() over (partition by tenant_id order by created_at asc, id asc) as rn
  from public.tenant_members
  where reports_to_id is null
)
update public.tenant_members m
set is_owner = true
from ranked r
where m.id = r.id
  and r.rn = 1
  and not exists (
    select 1 from public.tenant_members o
    where o.tenant_id = m.tenant_id and o.is_owner
  );

-- Enterprise: se houver owner_member_id provisionado, ele prevalece sobre o
-- palpite acima (mesma fonte que a sessão usava até agora).
update public.tenant_members m
set is_owner = false
where m.is_owner
  and exists (
    select 1 from public.enterprise_provisions e
    where e.tenant_id = m.tenant_id
      and e.owner_member_id is not null
      and e.owner_member_id <> m.id
  );

update public.tenant_members m
set is_owner = true
from public.enterprise_provisions e
where e.tenant_id = m.tenant_id
  and e.owner_member_id = m.id
  and not m.is_owner;

-- ── RLS + grants (app usa service_role; RLS fica ligada por consistência) ───

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

drop policy if exists "tenant_isolation" on public.teams;
create policy "tenant_isolation" on public.teams
  using (tenant_id = current_setting('app.tenant_id', true));

drop policy if exists "tenant_isolation" on public.team_members;
create policy "tenant_isolation" on public.team_members
  using (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update, delete on table public.teams to service_role;
grant select, insert, update, delete on table public.team_members to service_role;

comment on table public.teams is
  'Equipes do tenant. Criadas apenas pelo titular da conta (tenant_members.is_owner).';
comment on table public.team_members is
  'Vínculo colaborador-equipe. Diretor pode estar em N equipes; gerente e vendedor em no máximo uma (índice parcial team_members_one_team_for_manager_seller).';
comment on column public.tenant_members.is_owner is
  'Titular da conta (quem assinou o plano). Um por tenant, garantido por índice parcial único.';
