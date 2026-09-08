-- MyChat Recorder AI — nucleo do modulo de reunioes.
--
-- Aditiva: nao altera nenhuma tabela existente. Com a flag MEETINGS_ENABLED
-- desligada, estas tabelas ficam inertes.
--
-- Acesso: service_role apenas, no mesmo padrao das migrations recentes. O
-- isolamento entre empresas e aplicado na aplicacao
-- (lib/server/meeting-access-scope.ts); os grants aqui garantem que a anon key,
-- mesmo vazada, nao le nada.
--
-- Cotas de horas e prazos de retencao NAO vivem no schema de proposito: sao
-- politica comercial, moram em TypeScript e mudam sem migration.

-- ── meetings ────────────────────────────────────────────────────────────────

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,

  -- Nulo = gravada pelo titular da conta, que nao tem linha em tenant_members.
  created_by_employee_id text null references public.tenant_members(id) on delete set null,
  -- Carimbo de escopo denormalizado, como ja se faz em leads e agenda_events.
  team_id uuid null references public.teams(id) on delete set null,
  lead_id uuid null references public.leads(id) on delete set null,

  title text not null default '' check (char_length(title) <= 300),
  meeting_type text not null default 'geral' check (meeting_type ~ '^[a-z0-9_]{1,48}$'),
  language text not null default 'pt' check (language ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$'),
  source text not null check (source in ('record', 'upload')),
  tags text[] not null default '{}'::text[] check (array_length(tags, 1) is null or array_length(tags, 1) <= 20),

  visibility text not null default 'private'
    check (visibility in ('private', 'team', 'company', 'lead')),
  status text not null default 'draft'
    check (status in ('draft', 'uploading', 'queued', 'transcribing', 'analyzing', 'completed', 'partial', 'failed')),

  storage_bucket text not null default '',
  storage_key text not null check (char_length(storage_key) between 1 and 512),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  mime_type text not null default '' check (char_length(mime_type) <= 120),

  -- Estado do multipart do R2. Sem ele, uma gravacao interrompida nao tem como
  -- ser retomada depois de a aba morrer.
  upload_id text null check (upload_id is null or char_length(upload_id) between 1 and 512),
  upload_parts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(upload_parts) = 'array' and octet_length(upload_parts::text) <= 65536),

  duration_ms integer null check (duration_ms is null or (duration_ms >= 0 and duration_ms <= 86400000)),
  recorded_at timestamptz null,
  processing_version integer not null default 1 check (processing_version >= 1),

  provider text null check (provider is null or provider ~ '^[a-z0-9_]{1,32}$'),
  provider_job_id text null check (provider_job_id is null or char_length(provider_job_id) between 1 and 200),

  -- Anotacoes que o usuario escreveu durante a gravacao. Entram no contexto da
  -- analise: quem esta na sala sabe o que importa melhor que o modelo.
  user_notes text not null default '' check (char_length(user_notes) <= 20000),

  consent_ack_at timestamptz null,
  retention_until timestamptz null,
  audio_deleted_at timestamptz null,
  deleted_at timestamptz null,

  failed_reason text null check (failed_reason is null or failed_reason ~ '^[a-z0-9_]{1,96}$'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Necessario para a FK composta de meeting_jobs: garante que um job nunca
-- aponte para uma reuniao de outro tenant.
create unique index if not exists meetings_identity_idx
  on public.meetings (id, tenant_id);

-- Um objeto do R2 pertence a exatamente uma reuniao.
create unique index if not exists meetings_storage_key_idx
  on public.meetings (storage_key);

-- Idempotencia do webhook do provedor: callback repetido nao cria trabalho novo.
create unique index if not exists meetings_provider_job_idx
  on public.meetings (provider, provider_job_id)
  where provider_job_id is not null;

create index if not exists meetings_tenant_recent_idx
  on public.meetings (tenant_id, created_at desc)
  where deleted_at is null;

create index if not exists meetings_tenant_status_idx
  on public.meetings (tenant_id, status)
  where deleted_at is null;

create index if not exists meetings_tenant_lead_idx
  on public.meetings (tenant_id, lead_id)
  where lead_id is not null and deleted_at is null;

create index if not exists meetings_tenant_team_idx
  on public.meetings (tenant_id, team_id)
  where deleted_at is null;

create index if not exists meetings_tenant_author_idx
  on public.meetings (tenant_id, created_by_employee_id)
  where deleted_at is null;

-- Varredura de retencao: so as que ainda tem audio para apagar.
create index if not exists meetings_retention_due_idx
  on public.meetings (retention_until)
  where audio_deleted_at is null and retention_until is not null;

-- ── meeting_access_grants ───────────────────────────────────────────────────
-- Compartilhamento pontual com um colaborador que o escopo normal nao alcanca.

create table if not exists public.meeting_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  employee_id text not null references public.tenant_members(id) on delete cascade,
  granted_by_employee_id text null references public.tenant_members(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  unique (meeting_id, employee_id),
  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

create index if not exists meeting_access_grants_lookup_idx
  on public.meeting_access_grants (tenant_id, employee_id)
  where revoked_at is null;

-- ── meeting_jobs ────────────────────────────────────────────────────────────
-- Fila duravel espelhando agent_knowledge_jobs: lease, heartbeat, retry com
-- backoff e dead-letter. Nenhum estagio depende de funcao serverless longa.

create table if not exists public.meeting_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  meeting_id uuid not null,
  -- `transcript` existe para o webhook do provedor poder ser fino: ele so
  -- valida e enfileira, devolvendo 200 na hora. Buscar o texto e gravar
  -- milhares de segmentos num handler de webhook seria correr contra o timeout
  -- da funcao e arriscar o provedor reenviar o callback.
  stage text not null check (stage in ('prepare', 'transcript', 'analyze', 'index', 'notify', 'retention')),
  processing_version integer not null default 1 check (processing_version >= 1),
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
  payload jsonb not null default '{}'::jsonb
    check (octet_length(payload::text) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  -- Impede job duplicado do mesmo estagio para a mesma versao de processamento.
  unique (meeting_id, stage, processing_version),
  foreign key (meeting_id, tenant_id)
    references public.meetings(id, tenant_id) on delete cascade
);

create index if not exists meeting_jobs_due_idx
  on public.meeting_jobs (status, available_at)
  where status in ('pending', 'failed');

create index if not exists meeting_jobs_claim_idx
  on public.meeting_jobs (claim_expires_at)
  where status = 'processing';

create index if not exists meeting_jobs_tenant_idx
  on public.meeting_jobs (tenant_id, created_at desc);

-- Fila de dead-letter para o painel administrativo.
create index if not exists meeting_jobs_dead_letter_idx
  on public.meeting_jobs (updated_at desc)
  where status = 'dead_letter';

-- ── tenant_meeting_usage ────────────────────────────────────────────────────
-- Consumo por ciclo mensal, no mesmo formato de tenant_lead_usage
-- (cycle_month = primeiro dia do mes em UTC).

create table if not exists public.tenant_meeting_usage (
  tenant_id text not null references public.tenants(id) on delete cascade,
  cycle_month date not null,
  seconds_processed bigint not null default 0 check (seconds_processed >= 0),
  meetings_count integer not null default 0 check (meetings_count >= 0),
  bonus_seconds bigint not null default 0 check (bonus_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, cycle_month)
);

-- ── RLS e grants ────────────────────────────────────────────────────────────
-- Browser nao fala com estas tabelas em nenhuma hipotese.

alter table public.meetings enable row level security;
alter table public.meeting_access_grants enable row level security;
alter table public.meeting_jobs enable row level security;
alter table public.tenant_meeting_usage enable row level security;

revoke all on public.meetings from public, anon, authenticated;
revoke all on public.meeting_access_grants from public, anon, authenticated;
revoke all on public.meeting_jobs from public, anon, authenticated;
revoke all on public.tenant_meeting_usage from public, anon, authenticated;

grant select, insert, update, delete on public.meetings to service_role;
grant select, insert, update, delete on public.meeting_access_grants to service_role;
grant select, insert, update, delete on public.meeting_jobs to service_role;
grant select, insert, update on public.tenant_meeting_usage to service_role;

-- ── reserve_meeting_v1 ──────────────────────────────────────────────────────
-- Cria a reuniao em rascunho ja com a chave de storage carimbada com o tenant.
-- A chave nunca vem do cliente: e o que sustenta a validacao de prefixo na
-- rota que assina a URL de leitura.

create or replace function public.reserve_meeting_v1(
  p_meeting_id uuid,
  p_tenant_id text,
  p_created_by_employee_id text,
  p_team_id uuid,
  p_lead_id uuid,
  p_title text,
  p_meeting_type text,
  p_visibility text,
  p_source text,
  p_language text,
  p_storage_bucket text,
  p_storage_key text,
  p_mime_type text,
  p_retention_until timestamptz,
  p_consent_ack_at timestamptz
)
returns public.meetings
language plpgsql
security invoker
set search_path = public
as $reserve_meeting$
declare
  v_row public.meetings%rowtype;
  v_prefix text;
begin
  if p_tenant_id is null or btrim(p_tenant_id) = '' then
    raise exception 'meeting_tenant_required';
  end if;

  -- A chave TEM de viver sob o prefixo do proprio tenant. Sem esta checagem no
  -- banco, um bug futuro na camada de aplicacao viraria vazamento entre
  -- empresas assim que alguem assinasse uma URL de leitura.
  --
  -- Comparacao por prefixo literal, nao LIKE: `_` e `%` sao curingas de LIKE, e
  -- um tenant_id que os contenha afrouxaria justamente a checagem que existe
  -- para nunca afrouxar.
  v_prefix := 'meetings/' || p_tenant_id || '/';
  if p_storage_key is null or left(p_storage_key, length(v_prefix)) <> v_prefix then
    raise exception 'meeting_storage_key_outside_tenant';
  end if;

  -- Lead vinculado tem de ser do mesmo tenant.
  if p_lead_id is not null and not exists (
    select 1 from public.leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id
  ) then
    raise exception 'meeting_lead_foreign_tenant';
  end if;

  -- Equipe idem.
  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.tenant_id = p_tenant_id
  ) then
    raise exception 'meeting_team_foreign_tenant';
  end if;

  -- Colaborador idem.
  if p_created_by_employee_id is not null and not exists (
    select 1 from public.tenant_members m
     where m.id = p_created_by_employee_id and m.tenant_id = p_tenant_id
  ) then
    raise exception 'meeting_author_foreign_tenant';
  end if;

  -- Visibilidade "lead" sem lead vinculado nao decide nada e falharia fechado
  -- para todo mundo menos o titular: recusar aqui evita reuniao invisivel.
  if p_visibility = 'lead' and p_lead_id is null then
    raise exception 'meeting_lead_visibility_requires_lead';
  end if;

  insert into public.meetings (
    id, tenant_id, created_by_employee_id, team_id, lead_id,
    title, meeting_type, visibility, source, language,
    storage_bucket, storage_key, mime_type,
    retention_until, consent_ack_at, status
  ) values (
    coalesce(p_meeting_id, gen_random_uuid()), p_tenant_id, p_created_by_employee_id, p_team_id, p_lead_id,
    left(coalesce(p_title, ''), 300), coalesce(p_meeting_type, 'geral'),
    coalesce(p_visibility, 'private'), p_source, coalesce(p_language, 'pt'),
    coalesce(p_storage_bucket, ''), p_storage_key, left(coalesce(p_mime_type, ''), 120),
    p_retention_until, p_consent_ack_at, 'draft'
  )
  returning * into v_row;

  return v_row;
end;
$reserve_meeting$;

revoke all on function public.reserve_meeting_v1(
  uuid, text, text, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_meeting_v1(
  uuid, text, text, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, timestamptz
) to service_role;

-- ── enqueue_meeting_job_v1 ──────────────────────────────────────────────────

create or replace function public.enqueue_meeting_job_v1(
  p_meeting_id uuid,
  p_tenant_id text,
  p_stage text,
  p_payload jsonb default '{}'::jsonb
)
returns public.meeting_jobs
language plpgsql
security invoker
set search_path = public
as $enqueue_meeting_job$
declare
  v_meeting public.meetings%rowtype;
  v_row public.meeting_jobs%rowtype;
begin
  select * into v_meeting
    from public.meetings
   where id = p_meeting_id and tenant_id = p_tenant_id and deleted_at is null
   for update;
  if not found then
    raise exception 'meeting_not_found';
  end if;

  insert into public.meeting_jobs (
    tenant_id, meeting_id, stage, processing_version, payload, available_at
  ) values (
    p_tenant_id, p_meeting_id, p_stage, v_meeting.processing_version,
    coalesce(p_payload, '{}'::jsonb), now()
  )
  -- A linha existente e referenciada pelo NOME DA TABELA, sem schema:
  -- `public.meeting_jobs.status` nao e uma referencia valida dentro de
  -- ON CONFLICT DO UPDATE e faria a funcao falhar em tempo de execucao.
  on conflict (meeting_id, stage, processing_version) do update
    -- Reenfileirar um estagio ja concluido e no-op; um que falhou volta a ficar
    -- disponivel sem zerar a contagem de tentativas.
    set status = case
                   when meeting_jobs.status in ('failed', 'cancelled') then 'pending'
                   else meeting_jobs.status
                 end,
        available_at = case
                   when meeting_jobs.status in ('failed', 'cancelled') then now()
                   else meeting_jobs.available_at
                 end,
        payload = coalesce(excluded.payload, meeting_jobs.payload),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$enqueue_meeting_job$;

revoke all on function public.enqueue_meeting_job_v1(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_meeting_job_v1(uuid, text, text, jsonb)
  to service_role;

-- ── claim_meeting_jobs_v1 ───────────────────────────────────────────────────
-- Recupera leases vencidas e reivindica os proximos jobs prontos, em uma
-- transacao. `for update skip locked` permite varios workers em paralelo sem
-- processar o mesmo job duas vezes.

create or replace function public.claim_meeting_jobs_v1(
  p_limit integer default 3,
  p_claim_seconds integer default 120
)
returns setof public.meeting_jobs
language plpgsql
security invoker
set search_path = public
as $claim_meeting_jobs$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 3), 10));
  v_claim_seconds integer := greatest(30, least(coalesce(p_claim_seconds, 120), 600));
begin
  -- Lease vencida volta para a fila com backoff, ou morre em dead_letter.
  update public.meeting_jobs
     set status = case when attempts >= max_attempts then 'dead_letter' else 'failed' end,
         claim_token = null,
         claimed_at = null,
         claim_expires_at = null,
         heartbeat_at = null,
         last_error_code = 'claim_expired',
         available_at = case
           when attempts >= max_attempts then available_at
           else v_now + make_interval(secs => least(300, 15 * greatest(1, attempts)))
         end,
         updated_at = v_now
   where status = 'processing'
     and claim_expires_at <= v_now;

  return query
  with due as (
    select id
      from public.meeting_jobs
     where status in ('pending', 'failed')
       and attempts < max_attempts
       and available_at <= v_now
     order by available_at asc, created_at asc, id asc
     for update skip locked
     limit v_limit
  )
  update public.meeting_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         claim_token = gen_random_uuid(),
         claimed_at = v_now,
         claim_expires_at = v_now + make_interval(secs => v_claim_seconds),
         heartbeat_at = v_now,
         last_error_code = null,
         updated_at = v_now
    from due
   where j.id = due.id
  returning j.*;
end;
$claim_meeting_jobs$;

revoke all on function public.claim_meeting_jobs_v1(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_meeting_jobs_v1(integer, integer)
  to service_role;

-- ── heartbeat_meeting_job_v1 ────────────────────────────────────────────────

create or replace function public.heartbeat_meeting_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_extend_seconds integer default 120
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $heartbeat_meeting_job$
declare
  v_updated integer;
begin
  update public.meeting_jobs
     set heartbeat_at = clock_timestamp(),
         claim_expires_at = clock_timestamp() + make_interval(
           secs => greatest(30, least(coalesce(p_extend_seconds, 120), 600))
         ),
         updated_at = clock_timestamp()
   where id = p_job_id
     and status = 'processing'
     and claim_token = p_claim_token
     and claim_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$heartbeat_meeting_job$;

revoke all on function public.heartbeat_meeting_job_v1(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.heartbeat_meeting_job_v1(uuid, uuid, integer)
  to service_role;

-- ── finish_meeting_job_v1 ───────────────────────────────────────────────────
-- Fecha o job e move o status da reuniao junto, na mesma transacao. Falha em
-- `analyze` deixa a reuniao em `partial`, nunca em `failed`: a transcricao e o
-- audio ja entregues continuam valendo para o usuario.

create or replace function public.finish_meeting_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_meeting_status text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $finish_meeting_job$
declare
  v_job public.meeting_jobs%rowtype;
  v_error text;
  v_next_status text;
begin
  select * into v_job
    from public.meeting_jobs
   where id = p_job_id and status = 'processing' and claim_token = p_claim_token
   for update;
  if not found or v_job.claim_expires_at <= clock_timestamp() then
    return false;
  end if;

  v_error := case
    when coalesce(p_error_code, '') ~ '^[a-z0-9_]{1,96}$' then p_error_code
    else 'meeting_processing_failed'
  end;

  if coalesce(p_success, false) then
    update public.meeting_jobs
       set status = 'completed',
           claim_token = null,
           claim_expires_at = null,
           heartbeat_at = null,
           last_error_code = null,
           completed_at = now(),
           updated_at = now()
     where id = p_job_id;
  else
    update public.meeting_jobs
       set status = case when attempts >= max_attempts then 'dead_letter' else 'failed' end,
           claim_token = null,
           claim_expires_at = null,
           heartbeat_at = null,
           last_error_code = v_error,
           available_at = now() + make_interval(secs => least(300, 15 * greatest(1, attempts))),
           updated_at = now()
     where id = p_job_id;
  end if;

  -- Status da reuniao: o chamador manda o proximo estado quando deu certo.
  -- Quando falhou de vez, `analyze` degrada para `partial` (ha transcricao) e
  -- os demais estagios marcam `failed`.
  if coalesce(p_success, false) then
    v_next_status := p_meeting_status;
  elsif v_job.attempts >= v_job.max_attempts then
    v_next_status := case when v_job.stage = 'analyze' then 'partial' else 'failed' end;
  else
    v_next_status := null; -- ainda vai tentar de novo: nao mexe no status
  end if;

  if v_next_status is not null then
    update public.meetings
       set status = v_next_status,
           failed_reason = case when coalesce(p_success, false) then null else v_error end,
           updated_at = now()
     where id = v_job.meeting_id
       and tenant_id = v_job.tenant_id
       and processing_version = v_job.processing_version;
  end if;

  return true;
end;
$finish_meeting_job$;

revoke all on function public.finish_meeting_job_v1(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_meeting_job_v1(uuid, uuid, boolean, text, text)
  to service_role;

-- ── increment_meeting_usage_v1 ──────────────────────────────────────────────
-- Consumo do ciclo. Ler-somar-gravar no TypeScript perderia contagem quando
-- duas reunioes terminam ao mesmo tempo — exatamente o momento em que o numero
-- precisa estar certo.

create or replace function public.increment_meeting_usage_v1(
  p_tenant_id text,
  p_seconds integer
)
returns public.tenant_meeting_usage
language plpgsql
security invoker
set search_path = public
as $increment_usage$
declare
  v_row public.tenant_meeting_usage%rowtype;
  v_cycle date := date_trunc('month', now() at time zone 'utc')::date;
  v_seconds integer := greatest(0, coalesce(p_seconds, 0));
begin
  insert into public.tenant_meeting_usage (tenant_id, cycle_month, seconds_processed, meetings_count)
  values (p_tenant_id, v_cycle, v_seconds, case when v_seconds > 0 then 1 else 0 end)
  on conflict (tenant_id, cycle_month) do update
    set seconds_processed = tenant_meeting_usage.seconds_processed + v_seconds,
        meetings_count = tenant_meeting_usage.meetings_count + case when v_seconds > 0 then 1 else 0 end,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$increment_usage$;

revoke all on function public.increment_meeting_usage_v1(text, integer)
  from public, anon, authenticated;
grant execute on function public.increment_meeting_usage_v1(text, integer)
  to service_role;

-- ── Documentacao ────────────────────────────────────────────────────────────

comment on table public.meetings is
  'Reunioes gravadas ou enviadas. storage_key sempre sob o prefixo do proprio tenant — validado no banco por reserve_meeting_v1.';
comment on table public.meeting_jobs is
  'Fila duravel do pipeline de reunioes, com lease, heartbeat, retry limitado e dead-letter. Nenhum estagio exige funcao serverless longa.';
comment on table public.meeting_access_grants is
  'Compartilhamento pontual de uma reuniao com um colaborador fora do escopo normal.';
comment on table public.tenant_meeting_usage is
  'Consumo mensal de minutos por workspace. Cotas e retencao sao politica comercial e vivem em TypeScript, nao aqui.';
