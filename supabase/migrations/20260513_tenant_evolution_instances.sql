-- Instâncias Evolution API por tenant/linha WhatsApp (QR). Acesso só via service_role nas route handlers.

create table if not exists public.tenant_evolution_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  slot_index integer not null check (slot_index >= 0),
  instance_name text not null,
  connection_state text not null default 'close',
  wa_jid text null,
  default_agent_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slot_index),
  unique (instance_name)
);

create index if not exists tenant_evolution_instances_tenant_idx
  on public.tenant_evolution_instances (tenant_id);

create index if not exists tenant_evolution_instances_lookup_idx
  on public.tenant_evolution_instances (instance_name);

alter table public.tenant_evolution_instances enable row level security;

-- Sem políticas SELECT/INSERT para anon/authenticated: apenas PostgREST com service_role (rotas Next).

grant select, insert, update, delete on table public.tenant_evolution_instances to service_role;
