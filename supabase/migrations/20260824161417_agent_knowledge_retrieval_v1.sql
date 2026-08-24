-- Durable, tenant-isolated knowledge retrieval for universal agents.
-- The extension version is intentionally not pinned: hosted Supabase now
-- installs the current project default version.
create extension if not exists vector with schema extensions;

alter table public.agent_knowledge_files
  add column if not exists chunk_count integer not null default 0,
  add column if not exists processed_at timestamptz null,
  add column if not exists processing_version integer not null default 1,
  add column if not exists content_sha256 text null;

alter table public.agent_knowledge_files
  drop constraint if exists agent_knowledge_files_chunk_count_check;
alter table public.agent_knowledge_files
  add constraint agent_knowledge_files_chunk_count_check
  check (chunk_count >= 0 and chunk_count <= 4000);

alter table public.agent_knowledge_files
  drop constraint if exists agent_knowledge_files_processing_version_check,
  drop constraint if exists agent_knowledge_files_runtime_size_check,
  drop constraint if exists agent_knowledge_files_runtime_status_check;
alter table public.agent_knowledge_files
  add constraint agent_knowledge_files_processing_version_check
    check (processing_version >= 1) not valid,
  add constraint agent_knowledge_files_runtime_size_check
    check (
      status = 'failed'
      or (
        size_bytes > 0 and size_bytes <= 50 * 1024 * 1024
        and (mime_type not like 'image/%' or size_bytes <= 20 * 1024 * 1024)
      )
    ) not valid,
  add constraint agent_knowledge_files_runtime_status_check
    check (
      status in ('uploaded', 'processing', 'ready', 'failed')
      and extracted_text_status in ('pending', 'processing', 'ready', 'failed', 'unsupported')
    ) not valid;

create unique index if not exists agent_knowledge_files_identity_idx
  on public.agent_knowledge_files (id, tenant_id, agent_id);

create table if not exists public.agent_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  agent_id text not null,
  file_id uuid not null,
  processing_version integer not null check (processing_version >= 1),
  chunk_index integer not null check (chunk_index >= 0 and chunk_index < 4000),
  content text not null check (char_length(content) between 1 and 12000),
  token_count integer not null check (token_count between 1 and 2400),
  source_label text not null default '',
  embedding extensions.vector(1536) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (file_id, processing_version, chunk_index),
  foreign key (file_id, tenant_id, agent_id)
    references public.agent_knowledge_files(id, tenant_id, agent_id) on delete cascade
);

create index if not exists agent_knowledge_chunks_tenant_agent_idx
  on public.agent_knowledge_chunks (tenant_id, agent_id, file_id, processing_version, chunk_index);
create index if not exists agent_knowledge_chunks_embedding_hnsw_idx
  on public.agent_knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create table if not exists public.agent_knowledge_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  agent_id text not null,
  file_id uuid not null,
  processing_version integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  claim_token uuid null,
  claimed_at timestamptz null,
  claim_expires_at timestamptz null,
  heartbeat_at timestamptz null,
  last_error_code text null check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,96}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (file_id, processing_version),
  foreign key (file_id, tenant_id, agent_id)
    references public.agent_knowledge_files(id, tenant_id, agent_id) on delete cascade
);

create index if not exists agent_knowledge_jobs_due_idx
  on public.agent_knowledge_jobs (status, available_at)
  where status in ('pending', 'failed');
create index if not exists agent_knowledge_jobs_claim_idx
  on public.agent_knowledge_jobs (claim_expires_at)
  where status = 'processing';
create index if not exists agent_knowledge_jobs_tenant_agent_idx
  on public.agent_knowledge_jobs (tenant_id, agent_id, created_at desc);

-- Preserve legacy materials without injecting their former full text into the
-- prompt. Valid stored files are queued once for the contextual pipeline; the
-- original object and extracted_text remain untouched until the new job
-- commits successfully. Invalid legacy sizes stay visible with a diagnostic.
insert into public.agent_knowledge_jobs (
  tenant_id, agent_id, file_id, processing_version, status, available_at
)
select f.tenant_id, f.agent_id, f.id, f.processing_version, 'pending', now()
  from public.agent_knowledge_files f
  join public.tenant_agents a
    on a.tenant_id = f.tenant_id
   and a.agent_id = f.agent_id
   and a.archived_at is null
 where f.status in ('uploaded', 'processing', 'ready')
   and f.size_bytes > 0
   and f.size_bytes <= 50 * 1024 * 1024
   and (f.mime_type not like 'image/%' or f.size_bytes <= 20 * 1024 * 1024)
on conflict (file_id, processing_version) do nothing;

update public.agent_knowledge_files f
   set status = 'failed',
       extracted_text_status = 'failed',
       error_message = 'knowledge_legacy_size_review_required',
       updated_at = now()
 where f.status in ('uploaded', 'processing', 'ready')
   and (
     f.size_bytes <= 0
     or f.size_bytes > 50 * 1024 * 1024
     or (f.mime_type like 'image/%' and f.size_bytes > 20 * 1024 * 1024)
   );

alter table public.agent_knowledge_chunks enable row level security;
alter table public.agent_knowledge_jobs enable row level security;

revoke all on table public.agent_knowledge_files from public, anon, authenticated;
revoke all on table public.agent_knowledge_chunks from public, anon, authenticated;
revoke all on table public.agent_knowledge_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.agent_knowledge_chunks to service_role;
grant select, insert, update, delete on table public.agent_knowledge_jobs to service_role;

create or replace function public.reserve_agent_knowledge_file_v1(
  p_file_id uuid,
  p_tenant_id text,
  p_agent_id text,
  p_original_filename text,
  p_stored_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_storage_bucket text,
  p_storage_key text
)
returns public.agent_knowledge_files
language plpgsql
security invoker
set search_path = public
as $fn0$
declare
  v_count integer;
  v_total bigint;
  v_file public.agent_knowledge_files%rowtype;
  v_is_image boolean := coalesce(p_mime_type, '') like 'image/%';
begin
  if p_file_id is null or nullif(trim(p_tenant_id), '') is null or nullif(trim(p_agent_id), '') is null then
    raise exception 'knowledge_reservation_invalid';
  end if;
  if nullif(trim(p_original_filename), '') is null or nullif(trim(p_stored_filename), '') is null
     or nullif(trim(p_mime_type), '') is null
     or nullif(trim(p_storage_bucket), '') is null or nullif(trim(p_storage_key), '') is null then
    raise exception 'knowledge_reservation_invalid';
  end if;
  if p_size_bytes <= 0
     or (v_is_image and p_size_bytes > 20 * 1024 * 1024)
     or (not v_is_image and p_size_bytes > 50 * 1024 * 1024) then
    raise exception 'knowledge_file_size_invalid';
  end if;
  perform 1 from public.tenant_agents a
   where a.tenant_id = p_tenant_id and a.agent_id = p_agent_id
     and a.archived_at is null
   for key share;
  if not found then
    raise exception 'knowledge_agent_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'agent-knowledge-quota:' || p_tenant_id || ':' || p_agent_id, 0
  ));
  select count(*)::integer, coalesce(sum(size_bytes), 0)::bigint
    into v_count, v_total
    from public.agent_knowledge_files
   where tenant_id = p_tenant_id and agent_id = p_agent_id;
  if v_count >= 5 then raise exception 'knowledge_file_limit'; end if;
  if v_total + p_size_bytes > 200 * 1024 * 1024 then raise exception 'knowledge_total_size_limit'; end if;

  insert into public.agent_knowledge_files (
    id, tenant_id, agent_id, original_filename, stored_filename, mime_type,
    size_bytes, storage_bucket, storage_key, status, extracted_text_status
  ) values (
    p_file_id, p_tenant_id, p_agent_id, left(trim(p_original_filename), 300),
    left(trim(p_stored_filename), 300), left(trim(p_mime_type), 160), p_size_bytes,
    left(trim(p_storage_bucket), 300), left(trim(p_storage_key), 1000), 'uploaded', 'pending'
  ) returning * into v_file;
  return v_file;
end;
$fn0$;

revoke all on function public.reserve_agent_knowledge_file_v1(
  uuid, text, text, text, text, text, bigint, text, text
) from public, anon, authenticated;
grant execute on function public.reserve_agent_knowledge_file_v1(
  uuid, text, text, text, text, text, bigint, text, text
) to service_role;

create or replace function public.enqueue_agent_knowledge_job_v1(
  p_tenant_id text,
  p_agent_id text,
  p_file_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $fn1$
declare
  v_file public.agent_knowledge_files%rowtype;
  v_job_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'agent-knowledge-quota:' || p_tenant_id || ':' || p_agent_id, 0
  ));
  select * into v_file from public.agent_knowledge_files
   where id = p_file_id and tenant_id = p_tenant_id and agent_id = p_agent_id
   ;
  if not found then raise exception 'knowledge_file_not_found'; end if;
  if v_file.size_bytes <= 0
     or (v_file.mime_type like 'image/%' and v_file.size_bytes > 20 * 1024 * 1024)
     or (v_file.mime_type not like 'image/%' and v_file.size_bytes > 50 * 1024 * 1024) then
    raise exception 'knowledge_file_size_invalid';
  end if;
  if (select count(*) from public.agent_knowledge_files
       where tenant_id = p_tenant_id and agent_id = p_agent_id) > 5
     or (select coalesce(sum(size_bytes), 0) from public.agent_knowledge_files
          where tenant_id = p_tenant_id and agent_id = p_agent_id) > 200 * 1024 * 1024 then
    raise exception 'knowledge_quota_exceeded';
  end if;

  update public.agent_knowledge_jobs
     set status = 'cancelled', claim_token = null, claim_expires_at = null,
         heartbeat_at = null, updated_at = now()
   where file_id = p_file_id and status in ('pending', 'processing', 'failed');

  update public.agent_knowledge_files
     set status = 'processing', extracted_text_status = 'processing',
         processing_version = processing_version + 1,
         error_message = null, chunk_count = 0, processed_at = null,
         updated_at = now()
   where id = p_file_id
   returning * into v_file;

  delete from public.agent_knowledge_chunks where file_id = p_file_id;

  insert into public.agent_knowledge_jobs (
    tenant_id, agent_id, file_id, processing_version, status, available_at
  ) values (
    p_tenant_id, p_agent_id, p_file_id, v_file.processing_version, 'pending', now()
  ) returning id into v_job_id;
  return v_job_id;
end;
$fn1$;

revoke all on function public.enqueue_agent_knowledge_job_v1(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_agent_knowledge_job_v1(text, text, uuid)
  to service_role;

create or replace function public.delete_agent_knowledge_file_v1(
  p_tenant_id text,
  p_agent_id text,
  p_file_id uuid
)
returns text
language plpgsql
security invoker
set search_path = public
as $fn2$
declare
  v_storage_key text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'agent-knowledge-quota:' || p_tenant_id || ':' || p_agent_id, 0
  ));
  select storage_key into v_storage_key
    from public.agent_knowledge_files
   where id = p_file_id and tenant_id = p_tenant_id and agent_id = p_agent_id;
  if not found then raise exception 'knowledge_file_not_found'; end if;

  update public.agent_knowledge_jobs
     set status = 'cancelled', claim_token = null, claim_expires_at = null,
         heartbeat_at = null, updated_at = now()
   where file_id = p_file_id and status in ('pending', 'processing', 'failed');
  delete from public.agent_knowledge_files
   where id = p_file_id and tenant_id = p_tenant_id and agent_id = p_agent_id;
  return v_storage_key;
end;
$fn2$;

revoke all on function public.delete_agent_knowledge_file_v1(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_agent_knowledge_file_v1(text, text, uuid)
  to service_role;

create or replace function public.claim_agent_knowledge_jobs_v1(
  p_limit integer default 2,
  p_claim_seconds integer default 240
)
returns setof public.agent_knowledge_jobs
language plpgsql
security invoker
set search_path = public
as $fn3$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 2), 5));
  v_claim_seconds integer := greatest(60, least(coalesce(p_claim_seconds, 240), 600));
begin
  with reclaimed as (
    update public.agent_knowledge_jobs
       set status = case when attempts >= max_attempts then 'dead_letter' else 'failed' end,
           claim_token = null, claimed_at = null, claim_expires_at = null,
           heartbeat_at = null, last_error_code = 'claim_expired',
           available_at = case
             when attempts >= max_attempts then available_at
             else v_now + make_interval(secs => least(300, 15 * greatest(1, attempts)))
           end,
           updated_at = v_now
     where status = 'processing' and claim_expires_at <= v_now
    returning file_id, processing_version, status
  )
  update public.agent_knowledge_files f
     set status = 'failed', extracted_text_status = 'failed',
         error_message = case when r.status = 'dead_letter' then 'knowledge_dead_letter' else 'claim_expired' end,
         updated_at = v_now
    from reclaimed r
   where f.id = r.file_id and f.processing_version = r.processing_version;

  return query
  with due as (
    select id
      from public.agent_knowledge_jobs
     where status in ('pending', 'failed')
       and attempts < max_attempts
       and available_at <= v_now
     order by available_at asc, created_at asc, id asc
     for update skip locked
     limit v_limit
  ), claimed as (
  update public.agent_knowledge_jobs j
     set status = 'processing', attempts = j.attempts + 1,
         claim_token = gen_random_uuid(), claimed_at = v_now,
         claim_expires_at = v_now + make_interval(secs => v_claim_seconds),
         heartbeat_at = v_now, last_error_code = null, updated_at = v_now
    from due
   where j.id = due.id
  returning j.*
  ), marked as (
    update public.agent_knowledge_files f
       set status = 'processing', extracted_text_status = 'processing',
           error_message = null, updated_at = v_now
      from claimed c
     where f.id = c.file_id and f.processing_version = c.processing_version
    returning f.id
  )
  select c.* from claimed c;
end;
$fn3$;

revoke all on function public.claim_agent_knowledge_jobs_v1(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_agent_knowledge_jobs_v1(integer, integer)
  to service_role;

create or replace function public.heartbeat_agent_knowledge_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_extend_seconds integer default 240
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $fn4$
declare
  v_updated integer;
begin
  update public.agent_knowledge_jobs
     set heartbeat_at = clock_timestamp(),
         claim_expires_at = clock_timestamp() + make_interval(
           secs => greatest(60, least(coalesce(p_extend_seconds, 240), 600))
         ),
         updated_at = clock_timestamp()
   where id = p_job_id
     and status = 'processing'
     and claim_token = p_claim_token
     and claim_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$fn4$;

revoke all on function public.heartbeat_agent_knowledge_job_v1(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.heartbeat_agent_knowledge_job_v1(uuid, uuid, integer)
  to service_role;

create or replace function public.insert_agent_knowledge_chunks_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_chunks jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public, extensions
as $fn5$
declare
  v_job public.agent_knowledge_jobs%rowtype;
  v_chunk jsonb;
  v_index integer;
  v_content text;
  v_token_count integer;
  v_source_label text;
begin
  select * into v_job from public.agent_knowledge_jobs
   where id = p_job_id and status = 'processing' and claim_token = p_claim_token
   for update;
  if not found or v_job.claim_expires_at <= clock_timestamp() then return false; end if;
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) < 1
     or jsonb_array_length(p_chunks) > 80 then
    raise exception 'knowledge_chunk_batch_invalid';
  end if;

  for v_chunk in select value from jsonb_array_elements(p_chunks)
  loop
    if jsonb_typeof(v_chunk) <> 'object'
       or jsonb_typeof(v_chunk->'embedding') <> 'array'
       or jsonb_array_length(v_chunk->'embedding') <> 1536 then
      raise exception 'knowledge_chunk_invalid';
    end if;
    v_index := (v_chunk->>'chunk_index')::integer;
    v_content := v_chunk->>'content';
    v_token_count := (v_chunk->>'token_count')::integer;
    v_source_label := coalesce(v_chunk->>'source_label', 'material');
    if v_index < 0 or v_index >= 4000 or char_length(v_content) not between 1 and 12000
       or v_token_count not between 1 and 2400 then
      raise exception 'knowledge_chunk_invalid';
    end if;

    insert into public.agent_knowledge_chunks (
      tenant_id, agent_id, file_id, processing_version, chunk_index,
      content, token_count, source_label, embedding, updated_at
    ) values (
      v_job.tenant_id, v_job.agent_id, v_job.file_id, v_job.processing_version,
      v_index, v_content, v_token_count, left(v_source_label, 300),
      (v_chunk->'embedding')::text::extensions.vector(1536), clock_timestamp()
    )
    on conflict (file_id, processing_version, chunk_index) do update
      set content = excluded.content, token_count = excluded.token_count,
          source_label = excluded.source_label, embedding = excluded.embedding,
          updated_at = excluded.updated_at;
  end loop;

  update public.agent_knowledge_jobs
     set heartbeat_at = clock_timestamp(),
         claim_expires_at = clock_timestamp() + interval '240 seconds',
         updated_at = clock_timestamp()
   where id = v_job.id and claim_token = p_claim_token;
  return true;
end;
$fn5$;

revoke all on function public.insert_agent_knowledge_chunks_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_agent_knowledge_chunks_v1(uuid, uuid, jsonb)
  to service_role;

create or replace function public.finish_agent_knowledge_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_chunk_count integer default 0,
  p_content_sha256 text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $fn6$
declare
  v_job public.agent_knowledge_jobs%rowtype;
  v_actual_chunks integer;
begin
  select * into v_job from public.agent_knowledge_jobs
   where id = p_job_id and status = 'processing' and claim_token = p_claim_token
   for update;
  if not found or v_job.claim_expires_at <= clock_timestamp() then return false; end if;

  if coalesce(p_success, false) then
    if coalesce(p_content_sha256, '') !~ '^[a-f0-9]{64}$' then
      raise exception 'knowledge_content_hash_invalid';
    end if;
    select count(*)::integer into v_actual_chunks
      from public.agent_knowledge_chunks
     where file_id = v_job.file_id and processing_version = v_job.processing_version;
    if coalesce(p_chunk_count, 0) < 1 or v_actual_chunks <> p_chunk_count then
      raise exception 'knowledge_chunk_count_mismatch';
    end if;
  end if;

  if coalesce(p_success, false) then
    update public.agent_knowledge_jobs
       set status = 'completed', claim_token = null, claim_expires_at = null,
           heartbeat_at = null, completed_at = now(), updated_at = now()
     where id = p_job_id;
    update public.agent_knowledge_files
       set status = 'ready', extracted_text_status = 'ready',
           chunk_count = greatest(0, least(coalesce(p_chunk_count, 0), 4000)),
           processed_at = now(), content_sha256 = p_content_sha256,
           extracted_text = null, error_message = null, updated_at = now()
     where id = v_job.file_id and processing_version = v_job.processing_version;
    delete from public.agent_knowledge_chunks
     where file_id = v_job.file_id and processing_version <> v_job.processing_version;
  else
    update public.agent_knowledge_jobs
       set status = case when attempts >= max_attempts then 'dead_letter' else 'failed' end,
           claim_token = null, claim_expires_at = null, heartbeat_at = null,
           last_error_code = case when p_error_code ~ '^[a-z0-9_]{1,96}$' then p_error_code else 'processing_failed' end,
           available_at = now() + make_interval(secs => least(300, 15 * greatest(1, attempts))),
           updated_at = now()
     where id = p_job_id;
    update public.agent_knowledge_files
       set status = 'failed', extracted_text_status = 'failed',
           error_message = case
             when v_job.attempts >= v_job.max_attempts then 'knowledge_dead_letter'
             when p_error_code ~ '^[a-z0-9_]{1,96}$' then p_error_code
             else 'processing_failed'
           end,
           updated_at = now()
     where id = v_job.file_id and processing_version = v_job.processing_version;
    delete from public.agent_knowledge_chunks
     where file_id = v_job.file_id and processing_version = v_job.processing_version;
  end if;
  return true;
end;
$fn6$;

revoke all on function public.finish_agent_knowledge_job_v1(uuid, uuid, boolean, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_agent_knowledge_job_v1(uuid, uuid, boolean, integer, text, text)
  to service_role;

create or replace function public.match_agent_knowledge_chunks_v1(
  p_tenant_id text,
  p_agent_id text,
  p_embedding extensions.vector(1536),
  p_match_threshold double precision default 0.35,
  p_match_count integer default 8
)
returns table (
  chunk_id uuid,
  file_id uuid,
  source_label text,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
set hnsw.iterative_scan = 'strict_order'
as $fn7$
  select c.id, c.file_id, c.source_label, c.content,
         1 - (c.embedding <=> p_embedding) as similarity
    from public.agent_knowledge_chunks c
    join public.agent_knowledge_files f
      on f.id = c.file_id
     and f.tenant_id = c.tenant_id
     and f.agent_id = c.agent_id
     and f.processing_version = c.processing_version
     and f.status = 'ready'
     and f.extracted_text_status = 'ready'
    join public.tenant_agents a
      on a.tenant_id = c.tenant_id
     and a.agent_id = c.agent_id
     and a.archived_at is null
   where c.tenant_id = p_tenant_id
     and c.agent_id = p_agent_id
     and c.embedding is not null
     and 1 - (c.embedding <=> p_embedding) >= greatest(0, least(coalesce(p_match_threshold, 0.35), 1))
   order by c.embedding <=> p_embedding
   limit greatest(1, least(coalesce(p_match_count, 8), 20));
$fn7$;

revoke all on function public.match_agent_knowledge_chunks_v1(
  text, text, extensions.vector, double precision, integer
) from public, anon, authenticated;
grant execute on function public.match_agent_knowledge_chunks_v1(
  text, text, extensions.vector, double precision, integer
) to service_role;

comment on table public.agent_knowledge_chunks is
  'Tenant/agent isolated retrieval chunks. Content is untrusted reference data, never system instructions.';
comment on table public.agent_knowledge_jobs is
  'Durable extraction and embedding jobs with leases, bounded retries and dead-letter state.';
