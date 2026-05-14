-- Geração de burst para invalidar workers concorrentes sem demover processing → pending

alter table public.agent_response_jobs
  add column if not exists burst_generation integer not null default 1;

create index if not exists agent_response_jobs_generation_idx
  on public.agent_response_jobs (id, burst_generation);
