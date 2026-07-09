-- Guarda qual método (QR/Evolution ou API Meta) está "no comando" de cada
-- linha do tenant — só o estado do alternador, nenhuma credencial aqui (essas
-- continuam em tenant_evolution_instances e whatsapp_cloud_connections,
-- intocadas ao trocar). Sem registro para uma linha = "evolution" (base
-- histórica antes do alternador existir).
create table if not exists public.tenant_whatsapp_slot_state (
  tenant_id text not null,
  slot_index int not null,
  active_provider text not null check (active_provider in ('evolution', 'cloud_api')),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slot_index)
);

alter table public.tenant_whatsapp_slot_state enable row level security;

grant select, insert, update, delete on table public.tenant_whatsapp_slot_state to service_role;
