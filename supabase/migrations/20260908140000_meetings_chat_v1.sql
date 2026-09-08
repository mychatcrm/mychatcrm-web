-- MyChat Recorder AI — "Pergunte sobre esta reunião".
--
-- Aditiva. Depende de 20260907143000_meetings_core_v1.sql.
--
-- Para UMA reuniao nao ha RAG: uma hora de fala em portugues cabe folgado na
-- janela de contexto, e o transcript inteiro sai mais barato e mais preciso que
-- chunking com recuperacao. Esta tabela guarda a conversa e serve de cache das
-- perguntas repetidas ("faca um resumo em 3 linhas" e perguntada muitas vezes).

create table if not exists public.meeting_chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  processing_version integer not null default 1 check (processing_version >= 1),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 20000),

  -- Momentos citados na resposta, para a interface tornar cada afirmacao
  -- clicavel ate o trecho do audio que a sustenta.
  citations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(citations) = 'array' and octet_length(citations::text) <= 8192),

  -- Chave da pergunta normalizada + versao. Repetir a mesma pergunta devolve do
  -- banco em vez de pagar de novo.
  question_hash text null check (question_hash is null or question_hash ~ '^[a-f0-9]{64}$'),

  asked_by_employee_id text null references public.tenant_members(id) on delete set null,
  model text null check (model is null or char_length(model) <= 80),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),

  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

create index if not exists meeting_chat_messages_thread_idx
  on public.meeting_chat_messages (meeting_id, created_at asc);

create index if not exists meeting_chat_messages_cache_idx
  on public.meeting_chat_messages (meeting_id, processing_version, question_hash)
  where question_hash is not null and role = 'assistant';

alter table public.meeting_chat_messages enable row level security;
revoke all on public.meeting_chat_messages from public, anon, authenticated;
grant select, insert, delete on public.meeting_chat_messages to service_role;

comment on table public.meeting_chat_messages is
  'Perguntas e respostas sobre uma reuniao. O transcript entra no contexto como dado do usuario, nunca como instrucao de sistema.';
