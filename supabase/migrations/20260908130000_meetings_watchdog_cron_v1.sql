-- MyChat Recorder AI — watchdog de minuto.
--
-- Os crons da Vercel rodam uma vez por dia (ver docs/vercel-crons.md), o que
-- serve de rede de segurança diaria mas nao de watchdog. O pg_cron do Supabase
-- nao tem esse limite e ja e o caminho usado pelo follow-up — este arquivo
-- espelha aquele padrao, inclusive a assinatura HMAC com o caminho embutido.
--
-- Aditiva. Depende de 20260907143000_meetings_core_v1.sql.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;

-- Registro dos disparos: sem ele, "o watchdog rodou?" so se responde olhando
-- log de aplicacao, que nao guarda o que nunca chegou a sair daqui.
create table if not exists private.meeting_scheduler_dispatches (
  id bigserial primary key,
  nonce uuid null,
  request_id bigint null,
  status text not null check (status in ('queued', 'config_missing', 'request_failed')),
  created_at timestamptz not null default now()
);

create index if not exists meeting_scheduler_dispatches_recent_idx
  on private.meeting_scheduler_dispatches (created_at desc);

revoke all on table private.meeting_scheduler_dispatches
  from public, anon, authenticated;
grant select, insert, update, delete on table private.meeting_scheduler_dispatches
  to service_role;
grant usage, select on sequence private.meeting_scheduler_dispatches_id_seq
  to service_role;

create or replace function private.dispatch_meeting_jobs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $dispatch_meetings$
declare
  v_secret text;
  v_timestamp text;
  v_nonce uuid;
  v_path constant text := '/api/internal/meetings/watchdog';
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
    insert into private.meeting_scheduler_dispatches(status)
    values ('config_missing');
    return null;
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce := gen_random_uuid();
  -- O caminho entra na assinatura: uma chamada valida para o worker de
  -- follow-up nao pode ser reapresentada contra o de reunioes.
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

  insert into private.meeting_scheduler_dispatches(nonce, request_id, status)
  values (v_nonce, v_request, 'queued');
  return v_request;
exception when others then
  insert into private.meeting_scheduler_dispatches(nonce, status)
  values (v_nonce, 'request_failed');
  return null;
end;
$dispatch_meetings$;

revoke all on function private.dispatch_meeting_jobs()
  from public, anon, authenticated;
grant execute on function private.dispatch_meeting_jobs()
  to service_role;

-- Reagendamento idempotente.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'mychatcrm-meetings-minute';

select cron.schedule(
  'mychatcrm-meetings-minute',
  '* * * * *',
  $$select private.dispatch_meeting_jobs();$$
);

comment on table private.meeting_scheduler_dispatches is
  'Registro dos disparos do watchdog de reunioes. Distingue "nao rodou" de "rodou e falhou".';
