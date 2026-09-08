-- MyChat Recorder AI — analise, tarefas e decisoes.
--
-- Aditiva. Depende de 20260907143000_meetings_core_v1.sql e
-- 20260908120000_meetings_transcript_v1.sql.
--
-- Por que tarefas e decisoes sao TABELAS e nao campos do jsonb da analise:
-- precisam ser filtraveis ("reunioes da semana com pendencia"), ter estado
-- proprio (concluida/ignorada) e apontar para o compromisso criado na agenda.
-- Destaques, capitulos, topicos e mapa mental continuam no payload, porque sao
-- so leitura.

-- ── meeting_analyses ────────────────────────────────────────────────────────
-- Uma linha por (reuniao, versao de processamento, template). Rodar um segundo
-- template na mesma reuniao nao apaga o primeiro, e reprocessar com um modelo
-- melhor substitui apenas aquele template.

create table if not exists public.meeting_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  processing_version integer not null check (processing_version >= 1),
  template_key text not null check (template_key ~ '^[a-z0-9_]{1,48}$'),
  schema_version integer not null default 1 check (schema_version >= 1),

  summary_short text not null default '' check (char_length(summary_short) <= 2000),
  summary_long text not null default '' check (char_length(summary_long) <= 20000),

  -- topics, highlights, nextSteps, openQuestions, chapters, templateFields,
  -- speakerNameGuesses, mindMap.
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144),

  model text null check (model is null or char_length(model) <= 80),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (meeting_id, processing_version, template_key),
  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

create index if not exists meeting_analyses_meeting_idx
  on public.meeting_analyses (meeting_id, processing_version);

create index if not exists meeting_analyses_tenant_template_idx
  on public.meeting_analyses (tenant_id, template_key, created_at desc);

-- ── meeting_action_items ────────────────────────────────────────────────────

create table if not exists public.meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  processing_version integer not null check (processing_version >= 1),
  analysis_id uuid null references public.meeting_analyses(id) on delete set null,

  text text not null check (char_length(text) between 1 and 2000),
  -- Responsavel so e preenchido quando o nome aparece na transcricao; quando a
  -- IA nao sabe, fica nulo e a interface pede para o usuario escolher.
  assignee_employee_id text null references public.tenant_members(id) on delete set null,
  assignee_raw text null check (assignee_raw is null or char_length(assignee_raw) <= 160),

  due_date date null,
  -- "semana que vem" resolvido contra a data da reuniao — a interface marca
  -- como inferido para o usuario conferir antes de virar compromisso.
  due_date_inferred boolean not null default false,

  priority text not null default 'media' check (priority in ('baixa', 'media', 'alta')),
  status text not null default 'aberta' check (status in ('aberta', 'concluida', 'ignorada')),

  -- Momento da fala que originou a tarefa. Obrigatorio de proposito: item sem
  -- ancora no audio e alucinacao e o servidor descarta antes de chegar aqui.
  at_ms integer not null check (at_ms >= 0 and at_ms <= 86400000),

  applied_agenda_event_id uuid null references public.agenda_events(id) on delete set null,
  applied_at timestamptz null,
  applied_by_employee_id text null references public.tenant_members(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

create index if not exists meeting_action_items_meeting_idx
  on public.meeting_action_items (meeting_id, processing_version, at_ms);

create index if not exists meeting_action_items_open_idx
  on public.meeting_action_items (tenant_id, status, due_date)
  where status = 'aberta';

create index if not exists meeting_action_items_assignee_idx
  on public.meeting_action_items (tenant_id, assignee_employee_id)
  where assignee_employee_id is not null;

-- ── meeting_decisions ───────────────────────────────────────────────────────

create table if not exists public.meeting_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  processing_version integer not null check (processing_version >= 1),
  analysis_id uuid null references public.meeting_analyses(id) on delete set null,

  text text not null check (char_length(text) between 1 and 2000),
  at_ms integer not null check (at_ms >= 0 and at_ms <= 86400000),
  made_by_speaker_label text null check (made_by_speaker_label is null or char_length(made_by_speaker_label) <= 40),

  created_at timestamptz not null default now(),

  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

create index if not exists meeting_decisions_meeting_idx
  on public.meeting_decisions (meeting_id, processing_version, at_ms);

-- ── RLS e grants ────────────────────────────────────────────────────────────

alter table public.meeting_analyses enable row level security;
alter table public.meeting_action_items enable row level security;
alter table public.meeting_decisions enable row level security;

revoke all on public.meeting_analyses from public, anon, authenticated;
revoke all on public.meeting_action_items from public, anon, authenticated;
revoke all on public.meeting_decisions from public, anon, authenticated;

grant select, insert, update, delete on public.meeting_analyses to service_role;
grant select, insert, update, delete on public.meeting_action_items to service_role;
grant select, insert, update, delete on public.meeting_decisions to service_role;

-- ── save_meeting_analysis_v1 ────────────────────────────────────────────────
-- Grava analise, tarefas e decisoes numa unica transacao, sob a posse do job.
-- Sem isso, uma falha no meio deixaria a reuniao com resumo novo e tarefas
-- velhas.

create or replace function public.save_meeting_analysis_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_template_key text,
  p_schema_version integer,
  p_summary_short text,
  p_summary_long text,
  p_payload jsonb,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric,
  p_action_items jsonb,
  p_decisions jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $save_analysis$
declare
  v_job public.meeting_jobs%rowtype;
  v_analysis_id uuid;
  v_item jsonb;
  v_at_ms integer;
  v_text text;
begin
  select * into v_job
    from public.meeting_jobs
   where id = p_job_id and status = 'processing' and claim_token = p_claim_token
   for update;
  if not found or v_job.claim_expires_at <= clock_timestamp() then
    raise exception 'meeting_claim_lost';
  end if;

  if jsonb_typeof(coalesce(p_action_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_action_items, '[]'::jsonb)) > 200
     or jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_decisions, '[]'::jsonb)) > 200 then
    raise exception 'meeting_analysis_payload_invalid';
  end if;

  insert into public.meeting_analyses (
    tenant_id, meeting_id, processing_version, template_key, schema_version,
    summary_short, summary_long, payload, model, input_tokens, output_tokens, cost_usd
  ) values (
    v_job.tenant_id, v_job.meeting_id, v_job.processing_version,
    p_template_key, coalesce(p_schema_version, 1),
    left(coalesce(p_summary_short, ''), 2000),
    left(coalesce(p_summary_long, ''), 20000),
    coalesce(p_payload, '{}'::jsonb),
    left(nullif(coalesce(p_model, ''), ''), 80),
    greatest(0, coalesce(p_input_tokens, 0)),
    greatest(0, coalesce(p_output_tokens, 0)),
    greatest(0, coalesce(p_cost_usd, 0))
  )
  on conflict (meeting_id, processing_version, template_key) do update
    set schema_version = excluded.schema_version,
        summary_short = excluded.summary_short,
        summary_long = excluded.summary_long,
        payload = excluded.payload,
        model = excluded.model,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cost_usd = excluded.cost_usd,
        updated_at = now()
  returning id into v_analysis_id;

  -- Reprocessar substitui o que a IA propos, mas NAO destroi o que a pessoa ja
  -- tocou: tarefa concluida, ignorada ou ja transformada em compromisso na
  -- agenda sobrevive. Apagar isso seria desfazer trabalho humano.
  delete from public.meeting_action_items
   where meeting_id = v_job.meeting_id
     and processing_version = v_job.processing_version
     and analysis_id is not distinct from v_analysis_id
     and status = 'aberta'
     and applied_agenda_event_id is null;

  delete from public.meeting_decisions
   where meeting_id = v_job.meeting_id
     and processing_version = v_job.processing_version
     and analysis_id is not distinct from v_analysis_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_action_items, '[]'::jsonb))
  loop
    v_text := v_item->>'text';
    v_at_ms := (v_item->>'at_ms')::integer;
    -- Item sem ancora no audio nao entra. E a regra anti-alucinacao valendo no
    -- banco, nao so no prompt.
    if v_text is not null and char_length(v_text) between 1 and 2000
       and v_at_ms is not null and v_at_ms >= 0 and v_at_ms <= 86400000 then
      insert into public.meeting_action_items (
        tenant_id, meeting_id, processing_version, analysis_id,
        text, assignee_raw, due_date, due_date_inferred, priority, at_ms
      ) values (
        v_job.tenant_id, v_job.meeting_id, v_job.processing_version, v_analysis_id,
        v_text,
        left(nullif(coalesce(v_item->>'assignee_raw', ''), ''), 160),
        case when coalesce(v_item->>'due_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
             then (v_item->>'due_date')::date else null end,
        coalesce((v_item->>'due_date_inferred')::boolean, false),
        case when coalesce(v_item->>'priority', '') in ('baixa', 'media', 'alta')
             then v_item->>'priority' else 'media' end,
        v_at_ms
      );
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb))
  loop
    v_text := v_item->>'text';
    v_at_ms := (v_item->>'at_ms')::integer;
    if v_text is not null and char_length(v_text) between 1 and 2000
       and v_at_ms is not null and v_at_ms >= 0 and v_at_ms <= 86400000 then
      insert into public.meeting_decisions (
        tenant_id, meeting_id, processing_version, analysis_id,
        text, at_ms, made_by_speaker_label
      ) values (
        v_job.tenant_id, v_job.meeting_id, v_job.processing_version, v_analysis_id,
        v_text, v_at_ms,
        left(nullif(coalesce(v_item->>'made_by_speaker_label', ''), ''), 40)
      );
    end if;
  end loop;

  -- Nome sugerido pela IA fica guardado como sugestao. Nunca vira o nome
  -- exibido sozinho: quem confirma e o usuario.
  for v_item in select value from jsonb_array_elements(
    case when jsonb_typeof(coalesce(p_payload->'speakerNameGuesses', '[]'::jsonb)) = 'array'
         then p_payload->'speakerNameGuesses' else '[]'::jsonb end
  )
  loop
    update public.meeting_speakers
       set suggested_name = left(nullif(coalesce(v_item->>'guessedName', ''), ''), 120),
           suggested_evidence_ms = case
             when (v_item->>'evidenceAtMs') ~ '^\d+$' then (v_item->>'evidenceAtMs')::integer
             else null
           end,
           updated_at = now()
     where meeting_id = v_job.meeting_id
       and label = v_item->>'label'
       and is_confirmed = false;
  end loop;

  return v_analysis_id;
end;
$save_analysis$;

revoke all on function public.save_meeting_analysis_v1(
  uuid, uuid, text, integer, text, text, jsonb, text, integer, integer, numeric, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.save_meeting_analysis_v1(
  uuid, uuid, text, integer, text, text, jsonb, text, integer, integer, numeric, jsonb, jsonb
) to service_role;

comment on table public.meeting_analyses is
  'Analise por template, versionada. Rodar outro template ou reprocessar com modelo melhor nao apaga o resultado anterior.';
comment on table public.meeting_action_items is
  'Tarefas extraidas. at_ms e obrigatorio: item sem ancora no audio nao e persistido.';
comment on table public.meeting_decisions is
  'Decisoes extraidas, sempre ancoradas em um momento do audio.';
