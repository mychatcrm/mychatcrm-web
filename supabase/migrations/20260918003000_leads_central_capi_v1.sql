-- Central de Leads — Fase 4 (Conversions API para Leads)
--
-- Fecha o ciclo: a Meta manda o lead, o MyChatCRM devolve o que aconteceu com
-- ele. Sem esse retorno, o algoritmo da Meta otimiza para "quem preenche
-- formulário"; com ele, otimiza para "quem agenda e compra".
--
-- Os campos `conversion_send_enabled`, `conversion_pixel_id` e
-- `conversion_api_secret` já existiam em `lead_distribution_rules`, guardados e
-- nunca usados — esta fila é o que finalmente os liga a alguma coisa.
--
-- É uma outbox, não um envio direto: a Meta pode estar fora do ar no momento
-- exato em que o vendedor marca a venda, e perder essa conversão degrada a
-- campanha do cliente silenciosamente.

create schema if not exists private;
create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.meta_capi_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  lead_id uuid null references public.leads(id) on delete set null,
  leadgen_id text null,
  rule_id uuid null references public.lead_distribution_rules(id) on delete set null,
  event_name text not null
    check (event_name in ('Lead', 'Qualified', 'Schedule', 'Purchase', 'Contact')),
  event_time timestamptz not null default now(),
  /** Chave de deduplicação: o mesmo desfecho não pode virar duas conversões. */
  dedup_key text not null,
  pixel_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid null,
  claim_expires_at timestamptz null,
  last_error_code text null,
  last_error_message text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, dedup_key)
);

create index if not exists meta_capi_outbox_pending_idx
  on public.meta_capi_outbox (next_attempt_at)
  where status in ('pending', 'processing');

create index if not exists meta_capi_outbox_tenant_idx
  on public.meta_capi_outbox (tenant_id, created_at desc);

alter table public.meta_capi_outbox enable row level security;
revoke all on public.meta_capi_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.meta_capi_outbox to service_role;

-- Reivindicação atómica: dois workers em paralelo (cron do Postgres e rede de
-- segurança da Vercel) não podem enviar a mesma conversão duas vezes.
create or replace function public.claim_meta_capi_events_v1(p_limit integer default 20)
returns setof public.meta_capi_outbox
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claim uuid := gen_random_uuid();
begin
  return query
  with expired as (
    update public.meta_capi_outbox
       set status = 'failed',
           last_error_code = 'capi_retry_exhausted',
           claim_token = null,
           claim_expires_at = null,
           updated_at = now()
     where status in ('pending', 'processing')
       and (claim_expires_at is null or claim_expires_at < now())
       and attempts >= max_attempts
    returning id
  ),
  claimed as (
    update public.meta_capi_outbox
       set status = 'processing',
           claim_token = v_claim,
           claim_expires_at = now() + interval '5 minutes',
           attempts = attempts + 1,
           updated_at = now()
     where id in (
       select id
         from public.meta_capi_outbox
        where status in ('pending', 'processing')
          and next_attempt_at <= now()
          and attempts < max_attempts
          and (claim_expires_at is null or claim_expires_at < now())
          and id not in (select id from expired)
        order by next_attempt_at
        limit greatest(1, least(coalesce(p_limit, 20), 100))
        for update skip locked
     )
    returning *
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_meta_capi_events_v1(integer) from public, anon, authenticated;
grant execute on function public.claim_meta_capi_events_v1(integer) to service_role;

-- Agendamento: a fila precisa de um worker regular. O caminho quente do
-- MyChatCRM já vive no pg_cron (o plano Hobby da Vercel só permite 2 crons), e
-- a assinatura inclui o caminho — uma chamada válida para este worker não pode
-- ser reaproveitada noutro.

create table if not exists private.meta_capi_scheduler_dispatches (
  id bigint generated always as identity primary key,
  dispatched_at timestamptz not null default now(),
  nonce uuid,
  request_id bigint,
  status text not null check (status in ('queued', 'config_missing', 'request_failed'))
);

create index if not exists meta_capi_scheduler_dispatches_created_idx
  on private.meta_capi_scheduler_dispatches (dispatched_at desc);

revoke all on table private.meta_capi_scheduler_dispatches from public, anon, authenticated;
grant select, insert on table private.meta_capi_scheduler_dispatches to service_role;
grant usage, select on sequence private.meta_capi_scheduler_dispatches_id_seq to service_role;

create or replace function private.dispatch_meta_capi_delivery()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_timestamp text;
  v_nonce uuid;
  v_path constant text := '/api/internal/meta-capi-dispatch';
  v_signature text;
  v_request bigint;
begin
  select btrim(decrypted_secret)
    into v_secret
    from vault.decrypted_secrets
   where name = 'meta_leadgen_scheduler_secret'
   order by updated_at desc
   limit 1;

  if v_secret is null or octet_length(v_secret) < 32 then
    insert into private.meta_capi_scheduler_dispatches(status) values ('config_missing');
    return null;
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce := gen_random_uuid();
  v_signature := encode(
    extensions.hmac(
      convert_to(concat_ws(E'\n', 'POST', v_path, v_timestamp, v_nonce::text), 'UTF8'),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select net.http_post(
    url := 'https://www.mychatcrm.com.br' || v_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-MyChatCRM-Timestamp', v_timestamp,
      'X-MyChatCRM-Nonce', v_nonce::text,
      'X-MyChatCRM-Signature', 'sha256=' || v_signature
    ),
    timeout_milliseconds := 10000
  ) into v_request;

  insert into private.meta_capi_scheduler_dispatches(nonce, request_id, status)
  values (v_nonce, v_request, 'queued');
  return v_request;
exception when others then
  insert into private.meta_capi_scheduler_dispatches(nonce, status)
  values (v_nonce, 'request_failed');
  return null;
end;
$$;

revoke all on function private.dispatch_meta_capi_delivery() from public, anon, authenticated;
grant execute on function private.dispatch_meta_capi_delivery() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'mychatcrm-meta-capi-dispatch';

-- A cada 2 minutos: uma conversão não precisa chegar em segundos, e metade das
-- chamadas do minuto a minuto encontraria a fila vazia.
select cron.schedule(
  'mychatcrm-meta-capi-dispatch',
  '*/2 * * * *',
  $$select private.dispatch_meta_capi_delivery();$$
);
