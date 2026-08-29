-- Cover runtime foreign keys used by cancellation, reconciliation and deletes.
-- The tables are server-only and currently small; normal CREATE INDEX keeps
-- this migration transactional and rollback-safe in Supabase migrations.

create index if not exists agenda_reminder_jobs_v2_agenda_event_fk_idx
  on public.agenda_reminder_jobs_v2 (agenda_event_id);
create index if not exists agenda_reminder_jobs_v2_journey_fk_idx
  on public.agenda_reminder_jobs_v2 (journey_id);
create index if not exists agenda_reminder_jobs_v2_lead_fk_idx
  on public.agenda_reminder_jobs_v2 (lead_id)
  where lead_id is not null;
create index if not exists agenda_reminder_jobs_v2_outbox_fk_idx
  on public.agenda_reminder_jobs_v2 (outbox_id)
  where outbox_id is not null;
create index if not exists agenda_reminder_jobs_v2_rule_fk_idx
  on public.agenda_reminder_jobs_v2 (rule_id);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='follow_up_jobs' and column_name='journey_id') then
    execute 'create index if not exists follow_up_jobs_journey_fk_idx on public.follow_up_jobs (journey_id) where journey_id is not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='follow_up_jobs' and column_name='rule_id') then
    execute 'create index if not exists follow_up_jobs_rule_fk_idx on public.follow_up_jobs (rule_id) where rule_id is not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='follow_up_jobs' and column_name='source_response_job_id') then
    execute 'create index if not exists follow_up_jobs_source_response_fk_idx on public.follow_up_jobs (source_response_job_id) where source_response_job_id is not null';
  end if;
end;
$$;
