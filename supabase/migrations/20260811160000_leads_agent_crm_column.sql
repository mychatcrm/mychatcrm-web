-- Última coluna em que o AGENTE colocou o card do lead.
--
-- Serve para distinguir "o card está onde a automação deixou" de "alguém da
-- equipe arrastou isso à mão". Sem essa distinção, qualquer move automático
-- (follow-up, retorno do lead, agenda) sobrescreve silenciosamente o trabalho
-- de organização do vendedor.
--
-- A regra que isto habilita, em `applyAgentCrmMove`:
--   NULL                        -> o agente nunca mexeu neste card: pode mover
--   status = agent_crm_column_id-> está onde o agente deixou: pode mover
--   status <> agent_crm_column_id-> foi movido à mão: o agente não mexe mais
--
-- Também substitui `leads.first_reply_at` como trava de idempotência. Aquele
-- carimbo permitia mover só UMA vez na vida, o que impedia o ciclo
-- respondeu -> sumiu -> follow-up -> respondeu de novo de fechar. O campo
-- continua sendo gravado por ser dado útil, mas não decide mais nada.
--
-- NULL de propósito e sem backfill: leads que já existem entram como "o agente
-- nunca mexeu", que é verdade — nenhum move automático havia gravado
-- procedência antes desta migration.

alter table public.leads
  add column if not exists agent_crm_column_id text null;

comment on column public.leads.agent_crm_column_id is
  'Última coluna do CRM aplicada pelo agente. Se leads.status divergir deste valor, o card foi movido manualmente e a automação para de mexer nele.';
