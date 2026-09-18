-- Retenção da fila de respostas do pg_net
--
-- Em 18/09/2026 o banco de produção parou: o PostgREST devolvia
-- `503 PGRST002` ("Could not query the database for the schema cache") em
-- todas as chamadas e uma consulta trivial de auth levava ~24 s. Login de
-- cliente, login de admin, os webhooks da Evolution e todos os jobs internos
-- ficaram fora. Nenhum deploy havia saído — foi degradação acumulada.
--
-- O suspeito é esta tabela. O caminho quente do MyChatCRM vive em jobs de
-- pg_cron que disparam HTTP por `pg_net`, cinco deles de minuto a minuto. Cada
-- chamada grava uma linha em `net._http_response`, e **nada apaga essas
-- linhas**: a extensão não faz retenção sozinha. São ~7.200 linhas por dia,
-- indefinidamente, numa tabela que todo worker do pg_net lê.
--
-- Esta migração é preventiva e barata: vale mesmo que a causa daquele
-- incidente tenha sido outra. Uma fila de respostas HTTP já entregues não tem
-- por que guardar semanas de histórico.
--
-- Não há dado de negócio aqui: `net._http_response` guarda o resultado das
-- chamadas HTTP que o próprio banco fez, e o MyChatCRM lê essas respostas no
-- momento em que chegam, nunca dias depois.

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_deleted bigint;
begin
  -- Base sem pg_net (ambiente local, preview, instalação nova): nada a fazer.
  if to_regclass('net._http_response') is null then
    raise notice 'pg_net ausente — retenção não agendada';
    return;
  end if;

  -- Primeira limpeza, já nesta migração. Em DELETE grande o vacuum ainda teria
  -- de passar depois; por isso o corte é generoso (7 dias) e o job diário
  -- mantém a tabela pequena daqui para a frente.
  delete from net._http_response where created < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  raise notice 'pg_net: % respostas antigas removidas', v_deleted;
end $$;

-- Job diário, de madrugada, fora do horário comercial brasileiro.
select cron.unschedule(jobid) from cron.job where jobname = 'mychatcrm-pgnet-retention';

select cron.schedule(
  'mychatcrm-pgnet-retention',
  '15 4 * * *',
  $$delete from net._http_response where created < now() - interval '2 days'$$
);
