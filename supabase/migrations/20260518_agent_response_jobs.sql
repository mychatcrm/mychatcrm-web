-- Jobs de resposta do agente com debounce inteligente (serverless-safe)

create table if not exists public.agent_response_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  lead_id uuid null references public.leads(id) on delete set null,
  remote_jid text not null,
  agent_id text not null,
  instance_name text not null,
  status text not null default 'pending',
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  scheduled_for timestamptz not null,
  max_wait_until timestamptz not null,
  message_ids jsonb not null default '[]'::jsonb,
  inbound_message_count integer not null default 1,
  attempt_count integer not null default 0,
  locked_at timestamptz null,
  completed_at timestamptz null,
  failed_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_response_jobs_pending_unique_idx
  on public.agent_response_jobs (tenant_id, remote_jid)
  where status in ('pending', 'processing');

create index if not exists agent_response_jobs_due_idx
  on public.agent_response_jobs (status, scheduled_for)
  where status = 'pending';

create index if not exists agent_response_jobs_tenant_jid_idx
  on public.agent_response_jobs (tenant_id, remote_jid, created_at desc);

comment on column public.agent_response_jobs.status is
  'pending | processing | completed | cancelled | failed';

alter table public.agent_response_jobs enable row level security;
