-- Agent runtime memory and private knowledge files.
-- Uses whatsapp_messages as the canonical message log and adds conversation state,
-- summaries, lead metadata and R2-backed agent knowledge metadata.

alter table public.leads
  add column if not exists profile_metadata jsonb not null default '{}'::jsonb,
  add column if not exists ai_summary text null,
  add column if not exists lead_temperature text null,
  add column if not exists suggested_next_action text null;

create table if not exists public.conversation_states (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  remote_jid text not null,
  lead_id uuid null references public.leads(id) on delete set null,
  agent_id text null,
  channel text not null default 'whatsapp',
  status text not null default 'active',
  human_paused boolean not null default false,
  paused_reason text null,
  paused_by text null,
  paused_at timestamptz null,
  resumed_at timestamptz null,
  last_message_at timestamptz null,
  last_summary_at timestamptz null,
  handoff_suggested boolean not null default false,
  handoff_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, remote_jid, channel)
);

create table if not exists public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  remote_jid text not null,
  conversation_state_id uuid null references public.conversation_states(id) on delete cascade,
  lead_id uuid null references public.leads(id) on delete set null,
  agent_id text null,
  summary text not null,
  customer_intent text null,
  lead_temperature text null,
  suggested_next_action text null,
  objections text[] not null default '{}',
  important_facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_knowledge_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  agent_id text not null,
  original_filename text not null,
  stored_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_bucket text not null,
  storage_key text not null unique,
  status text not null default 'uploaded',
  extracted_text_status text not null default 'pending',
  extracted_text text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_states_tenant_jid_idx
  on public.conversation_states (tenant_id, remote_jid);

create index if not exists conversation_summaries_tenant_jid_created_idx
  on public.conversation_summaries (tenant_id, remote_jid, created_at desc);

create index if not exists agent_knowledge_files_tenant_agent_idx
  on public.agent_knowledge_files (tenant_id, agent_id);

create index if not exists agent_knowledge_files_status_idx
  on public.agent_knowledge_files (status);

alter table public.conversation_states enable row level security;
alter table public.conversation_summaries enable row level security;
alter table public.agent_knowledge_files enable row level security;

grant select, insert, update, delete on table public.conversation_states to service_role;
grant select, insert, update, delete on table public.conversation_summaries to service_role;
grant select, insert, update, delete on table public.agent_knowledge_files to service_role;
