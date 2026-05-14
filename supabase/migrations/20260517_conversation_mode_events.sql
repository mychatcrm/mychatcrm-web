-- Modo operacional híbrido IA + humano e timeline de eventos

alter table public.conversation_states
  add column if not exists conversation_mode text null default 'automation',
  add column if not exists assigned_human_id text null,
  add column if not exists assigned_human_name text null,
  add column if not exists transferred_from text null,
  add column if not exists transferred_to text null,
  add column if not exists transfer_reason text null;

create index if not exists conversation_states_tenant_mode_idx
  on public.conversation_states (tenant_id, conversation_mode);

create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  remote_jid text not null,
  lead_id uuid null references public.leads(id) on delete set null,
  conversation_state_id uuid null references public.conversation_states(id) on delete set null,
  event_type text not null,
  title text not null,
  detail text null,
  actor_type text null,
  actor_id text null,
  actor_name text null,
  transferred_from text null,
  transferred_to text null,
  transfer_reason text null,
  created_at timestamptz not null default now()
);

create index if not exists conversation_events_tenant_jid_created_idx
  on public.conversation_events (tenant_id, remote_jid, created_at asc);

create index if not exists conversation_events_tenant_lead_created_idx
  on public.conversation_events (tenant_id, lead_id, created_at asc);

comment on column public.conversation_states.conversation_mode is
  'automation | waiting_human | human';

alter table public.conversation_events enable row level security;
