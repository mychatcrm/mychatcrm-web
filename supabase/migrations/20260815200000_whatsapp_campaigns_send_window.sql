-- Janela de envio configurável por campanha.
--
-- Até aqui o disparo saía sempre que o processador acordasse, e quem acordava
-- era o cron de follow-up (1×/dia, 4h da manhã). Duas consequências ruins:
-- lista de mil pessoas levava ~13 dias, e não havia como o cliente dizer
-- "só mande em horário comercial" ou "só na terça".
--
-- O formato espelha `followUpInteligente` (mesmos campos, mesma semântica) para
-- reusar `isWithinBusinessHours` de lib/server/follow-up-engine.ts em vez de
-- criar um segundo avaliador de janela que divergiria com o tempo:
--   { ativo, diasAtivos[0-6], horaInicio, minutoInicio, horaFim, minutoFim, timezone }
--
-- NULL / `{}` de propósito: campanha sem janela continua enviando a qualquer
-- hora, que é o comportamento de hoje. Nada muda para o que já existe.

alter table public.whatsapp_campaigns
  add column if not exists send_window jsonb not null default '{}'::jsonb;

comment on column public.whatsapp_campaigns.send_window is
  'Janela de envio: { ativo, diasAtivos, horaInicio, minutoInicio, horaFim, minutoFim, timezone }. Vazio = envia a qualquer hora.';
