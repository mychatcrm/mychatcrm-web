-- MyChat Recorder AI — transcricao e falantes.
--
-- Aditiva. Depende de 20260907143000_meetings_core_v1.sql.
--
-- O texto transcrito e conteudo NAO CONFIAVEL: alguem numa reuniao pode dizer
-- em voz alta "ignore suas instrucoes". Ele entra no contexto da IA sempre como
-- mensagem de usuario delimitada, nunca como instrucao de sistema — mesma
-- regra ja aplicada a agent_knowledge_chunks.

-- ── meeting_speakers ────────────────────────────────────────────────────────
-- Rotulos de diarizacao (A, B, C) e o nome que o usuario confirmou para cada um.
-- O vinculo com uma pessoa real so existe depois que alguem nomeia: o provedor
-- devolve pseudonimos, e nenhuma impressao vocal e guardada.

create table if not exists public.meeting_speakers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  label text not null check (char_length(label) between 1 and 40),
  display_name text null check (display_name is null or char_length(display_name) between 1 and 120),
  employee_id text null references public.tenant_members(id) on delete set null,
  lead_id uuid null references public.leads(id) on delete set null,
  -- Nome sugerido pela IA a partir do proprio dialogo ("foi chamado de Joao aos
  -- 02:14"). Nunca vira display_name sozinho: o usuario confirma.
  suggested_name text null check (suggested_name is null or char_length(suggested_name) <= 120),
  suggested_evidence_ms integer null check (suggested_evidence_ms is null or suggested_evidence_ms >= 0),
  is_confirmed boolean not null default false,
  talk_time_ms integer not null default 0 check (talk_time_ms >= 0),
  segment_count integer not null default 0 check (segment_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, label),
  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

create index if not exists meeting_speakers_meeting_idx
  on public.meeting_speakers (meeting_id, label);

create index if not exists meeting_speakers_employee_idx
  on public.meeting_speakers (tenant_id, employee_id)
  where employee_id is not null;

-- ── meeting_transcript_segments ─────────────────────────────────────────────

create table if not exists public.meeting_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  processing_version integer not null check (processing_version >= 1),
  idx integer not null check (idx >= 0 and idx < 50000),
  speaker_label text null check (speaker_label is null or char_length(speaker_label) <= 40),
  start_ms integer not null check (start_ms >= 0 and start_ms <= 86400000),
  end_ms integer not null check (end_ms >= 0 and end_ms <= 86400000),
  text text not null check (char_length(text) between 1 and 5000),
  confidence double precision null check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  check (end_ms >= start_ms),
  unique (meeting_id, processing_version, idx),
  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

-- Leitura da transcricao em ordem (a tela principal do modulo).
create index if not exists meeting_transcript_segments_read_idx
  on public.meeting_transcript_segments (meeting_id, processing_version, idx);

-- "Que trecho toca agora?" e "leve o audio para este ponto".
create index if not exists meeting_transcript_segments_time_idx
  on public.meeting_transcript_segments (meeting_id, processing_version, start_ms);

-- ── RLS e grants ────────────────────────────────────────────────────────────

alter table public.meeting_speakers enable row level security;
alter table public.meeting_transcript_segments enable row level security;

revoke all on public.meeting_speakers from public, anon, authenticated;
revoke all on public.meeting_transcript_segments from public, anon, authenticated;

grant select, insert, update, delete on public.meeting_speakers to service_role;
grant select, insert, update, delete on public.meeting_transcript_segments to service_role;

-- ── append_meeting_transcript_segments_v1 ───────────────────────────────────
-- Insercao em lotes, chamada varias vezes pelo worker `transcript`.
--
-- A autorizacao e por `provider_job_id`: um callback forjado que aponte para a
-- reuniao de outra empresa nao casa com o job registrado e nao escreve nada.

create or replace function public.append_meeting_transcript_segments_v1(
  p_meeting_id uuid,
  p_tenant_id text,
  p_provider_job_id text,
  p_processing_version integer,
  p_segments jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $append_segments$
declare
  v_meeting public.meetings%rowtype;
  v_segment jsonb;
  v_idx integer;
  v_start integer;
  v_end integer;
  v_text text;
  v_count integer := 0;
begin
  select * into v_meeting
    from public.meetings
   where id = p_meeting_id and tenant_id = p_tenant_id and deleted_at is null
   for update;
  if not found then
    raise exception 'meeting_not_found';
  end if;

  if v_meeting.provider_job_id is distinct from p_provider_job_id then
    raise exception 'meeting_provider_job_mismatch';
  end if;

  if v_meeting.processing_version <> p_processing_version then
    raise exception 'meeting_version_stale';
  end if;

  if jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) < 1
     or jsonb_array_length(p_segments) > 500 then
    raise exception 'meeting_segment_batch_invalid';
  end if;

  for v_segment in select value from jsonb_array_elements(p_segments)
  loop
    if jsonb_typeof(v_segment) <> 'object' then
      raise exception 'meeting_segment_invalid';
    end if;

    v_idx := (v_segment->>'idx')::integer;
    v_start := (v_segment->>'start_ms')::integer;
    v_end := (v_segment->>'end_ms')::integer;
    v_text := v_segment->>'text';

    if v_idx is null or v_idx < 0 or v_idx >= 50000
       or v_start is null or v_start < 0
       or v_end is null or v_end < v_start
       or v_text is null or char_length(v_text) not between 1 and 5000 then
      raise exception 'meeting_segment_invalid';
    end if;

    insert into public.meeting_transcript_segments (
      tenant_id, meeting_id, processing_version, idx,
      speaker_label, start_ms, end_ms, text, confidence
    ) values (
      p_tenant_id, p_meeting_id, p_processing_version, v_idx,
      nullif(left(coalesce(v_segment->>'speaker_label', ''), 40), ''),
      v_start, v_end, v_text,
      case when v_segment ? 'confidence' then (v_segment->>'confidence')::double precision else null end
    )
    -- Reentrante: se o worker morrer no meio de um lote e o job repetir, o
    -- mesmo indice e sobrescrito em vez de duplicar a fala.
    on conflict (meeting_id, processing_version, idx) do update
      set speaker_label = excluded.speaker_label,
          start_ms = excluded.start_ms,
          end_ms = excluded.end_ms,
          text = excluded.text,
          confidence = excluded.confidence;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$append_segments$;

revoke all on function public.append_meeting_transcript_segments_v1(uuid, text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_meeting_transcript_segments_v1(uuid, text, text, integer, jsonb)
  to service_role;

-- ── finalize_meeting_transcript_v1 ──────────────────────────────────────────
-- Fecha a transcricao: grava falantes, duracao e idioma, calcula tempo de fala
-- e move a reuniao para `analyzing`. Idempotente.

create or replace function public.finalize_meeting_transcript_v1(
  p_meeting_id uuid,
  p_tenant_id text,
  p_provider_job_id text,
  p_processing_version integer,
  p_duration_ms integer,
  p_language text,
  p_speaker_labels jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $finalize_transcript$
declare
  v_meeting public.meetings%rowtype;
  v_label text;
begin
  select * into v_meeting
    from public.meetings
   where id = p_meeting_id and tenant_id = p_tenant_id and deleted_at is null
   for update;
  if not found then
    raise exception 'meeting_not_found';
  end if;

  if v_meeting.provider_job_id is distinct from p_provider_job_id then
    raise exception 'meeting_provider_job_mismatch';
  end if;

  if v_meeting.processing_version <> p_processing_version then
    raise exception 'meeting_version_stale';
  end if;

  -- Ja finalizada: callback repetido do provedor nao refaz trabalho.
  if v_meeting.status in ('analyzing', 'completed', 'partial') then
    return false;
  end if;

  if jsonb_typeof(p_speaker_labels) <> 'array' or jsonb_array_length(p_speaker_labels) > 40 then
    raise exception 'meeting_speaker_labels_invalid';
  end if;

  for v_label in select jsonb_array_elements_text(p_speaker_labels)
  loop
    if char_length(v_label) between 1 and 40 then
      insert into public.meeting_speakers (tenant_id, meeting_id, label)
      values (p_tenant_id, p_meeting_id, v_label)
      -- Renomeacao feita pelo usuario sobrevive a um reprocessamento: o
      -- conflito nao toca display_name nem is_confirmed.
      on conflict (meeting_id, label) do nothing;
    end if;
  end loop;

  -- Tempo de fala e contagem por falante, direto dos segmentos gravados.
  update public.meeting_speakers s
     set talk_time_ms = coalesce(agg.total_ms, 0),
         segment_count = coalesce(agg.total_count, 0),
         updated_at = now()
    from (
      select speaker_label,
             sum(end_ms - start_ms)::integer as total_ms,
             count(*)::integer as total_count
        from public.meeting_transcript_segments
       where meeting_id = p_meeting_id
         and processing_version = p_processing_version
         and speaker_label is not null
       group by speaker_label
    ) agg
   where s.meeting_id = p_meeting_id
     and s.label = agg.speaker_label;

  update public.meetings
     set status = 'analyzing',
         duration_ms = coalesce(p_duration_ms, duration_ms),
         language = coalesce(nullif(p_language, ''), language),
         failed_reason = null,
         updated_at = now()
   where id = p_meeting_id and tenant_id = p_tenant_id;

  return true;
end;
$finalize_transcript$;

revoke all on function public.finalize_meeting_transcript_v1(uuid, text, text, integer, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_meeting_transcript_v1(uuid, text, text, integer, integer, text, jsonb)
  to service_role;

comment on table public.meeting_transcript_segments is
  'Falas transcritas com falante e tempo. Conteudo NAO confiavel: entra na IA como dado do usuario, nunca como instrucao de sistema.';
comment on table public.meeting_speakers is
  'Rotulos de diarizacao e o nome confirmado pelo usuario. Nenhuma impressao vocal (dado biometrico) e armazenada.';
