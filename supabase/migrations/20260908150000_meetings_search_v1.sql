-- MyChat Recorder AI — busca entre reunioes.
--
-- Aditiva. Depende de 20260907143000_meetings_core_v1.sql.
--
-- Busca HIBRIDA de proposito. Vetorial sozinha erra termo exato (nome de
-- cliente, numero de contrato); lexical sozinha erra parafrase ("contratar
-- gente" nao casa "mais dois vendedores"). As duas listas sao fundidas por
-- Reciprocal Rank Fusion, que nao exige normalizar scores de escalas diferentes.

create extension if not exists vector with schema extensions;

create table if not exists public.meeting_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  processing_version integer not null check (processing_version >= 1),
  idx integer not null check (idx >= 0 and idx < 20000),

  content text not null check (char_length(content) between 1 and 6000),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= 0),

  embedding extensions.vector(1536) null,
  -- Coluna gerada: o indice lexical nunca sai de sincronia com o texto.
  tsv tsvector generated always as (to_tsvector('portuguese', content)) stored,

  created_at timestamptz not null default now(),

  unique (meeting_id, processing_version, idx),
  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

create index if not exists meeting_chunks_tenant_idx
  on public.meeting_chunks (tenant_id, meeting_id, processing_version, idx);

create index if not exists meeting_chunks_embedding_hnsw_idx
  on public.meeting_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create index if not exists meeting_chunks_tsv_idx
  on public.meeting_chunks using gin (tsv);

alter table public.meeting_chunks enable row level security;
revoke all on public.meeting_chunks from public, anon, authenticated;
grant select, insert, update, delete on public.meeting_chunks to service_role;

-- ── insert_meeting_chunks_v1 ────────────────────────────────────────────────
-- Gravacao em lote sob a posse do job, no mesmo padrao dos chunks de material.

create or replace function public.insert_meeting_chunks_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_chunks jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, extensions
as $insert_meeting_chunks$
declare
  v_job public.meeting_jobs%rowtype;
  v_chunk jsonb;
  v_count integer := 0;
begin
  select * into v_job
    from public.meeting_jobs
   where id = p_job_id and status = 'processing' and claim_token = p_claim_token
   for update;
  if not found or v_job.claim_expires_at <= clock_timestamp() then
    raise exception 'meeting_claim_lost';
  end if;

  if jsonb_typeof(p_chunks) <> 'array'
     or jsonb_array_length(p_chunks) < 1
     or jsonb_array_length(p_chunks) > 96 then
    raise exception 'meeting_chunk_batch_invalid';
  end if;

  for v_chunk in select value from jsonb_array_elements(p_chunks)
  loop
    if jsonb_typeof(v_chunk->'embedding') <> 'array'
       or jsonb_array_length(v_chunk->'embedding') <> 1536 then
      raise exception 'meeting_chunk_embedding_invalid';
    end if;

    insert into public.meeting_chunks (
      tenant_id, meeting_id, processing_version, idx, content, start_ms, end_ms, embedding
    ) values (
      v_job.tenant_id, v_job.meeting_id, v_job.processing_version,
      (v_chunk->>'idx')::integer,
      v_chunk->>'content',
      (v_chunk->>'start_ms')::integer,
      (v_chunk->>'end_ms')::integer,
      (v_chunk->'embedding')::text::extensions.vector(1536)
    )
    on conflict (meeting_id, processing_version, idx) do update
      set content = excluded.content,
          start_ms = excluded.start_ms,
          end_ms = excluded.end_ms,
          embedding = excluded.embedding;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$insert_meeting_chunks$;

revoke all on function public.insert_meeting_chunks_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_meeting_chunks_v1(uuid, uuid, jsonb)
  to service_role;

-- ── search_meeting_chunks_v1 ────────────────────────────────────────────────
-- Fusao por rank reciproco (RRF): cada lista contribui 1/(k + posicao). Nao
-- exige normalizar similaridade de cosseno contra ts_rank, que vivem em escalas
-- diferentes e nao sao comparaveis diretamente.
--
-- `p_meeting_ids` chega JA RECORTADO pelo escopo do usuario, calculado na
-- aplicacao. Esta funcao nao decide permissao: lista vazia devolve zero linhas.

create or replace function public.search_meeting_chunks_v1(
  p_tenant_id text,
  p_meeting_ids uuid[],
  p_query text,
  p_embedding extensions.vector(1536),
  p_limit integer default 20
)
returns table (
  meeting_id uuid,
  chunk_id uuid,
  content text,
  start_ms integer,
  score double precision
)
language sql
stable
security invoker
set search_path = public, extensions
set hnsw.iterative_scan = 'strict_order'
as $search_meeting_chunks$
  with scoped as (
    select c.*
      from public.meeting_chunks c
      join public.meetings m
        on m.id = c.meeting_id
       and m.tenant_id = c.tenant_id
       and m.processing_version = c.processing_version
       and m.deleted_at is null
     where c.tenant_id = p_tenant_id
       and c.meeting_id = any(p_meeting_ids)
  ),
  semantic as (
    select id, meeting_id, content, start_ms,
           row_number() over (order by embedding <=> p_embedding) as rank
      from scoped
     where embedding is not null and p_embedding is not null
     limit 60
  ),
  lexical as (
    select id, meeting_id, content, start_ms,
           row_number() over (
             order by ts_rank(tsv, websearch_to_tsquery('portuguese', p_query)) desc
           ) as rank
      from scoped
     where p_query is not null
       and btrim(p_query) <> ''
       and tsv @@ websearch_to_tsquery('portuguese', p_query)
     limit 60
  ),
  fused as (
    select coalesce(s.id, l.id) as id,
           coalesce(s.meeting_id, l.meeting_id) as meeting_id,
           coalesce(s.content, l.content) as content,
           coalesce(s.start_ms, l.start_ms) as start_ms,
           coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + l.rank), 0) as score
      from semantic s
      full outer join lexical l on l.id = s.id
  )
  select meeting_id, id, content, start_ms, score
    from fused
   order by score desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$search_meeting_chunks$;

revoke all on function public.search_meeting_chunks_v1(
  text, uuid[], text, extensions.vector, integer
) from public, anon, authenticated;
grant execute on function public.search_meeting_chunks_v1(
  text, uuid[], text, extensions.vector, integer
) to service_role;

comment on table public.meeting_chunks is
  'Trechos indexados para busca entre reunioes. Conteudo e dado nao confiavel, nunca instrucao.';
