-- Disparo "único": manda a mensagem e não continua a conversa pela IA.
--
-- Até aqui, quem responde ao disparo sempre é atendido automaticamente pelo
-- agente de disparos. Agora o dono da conta pode desligar isso por campanha:
-- a mensagem sai igual, mas a automação é pausada logo depois do envio
-- (mesmo mecanismo de `pauseConversationForLeadOutcome` — RPC
-- set_conversation_operation_v2, não update cru), e o lead fica esperando um
-- humano assumir. O botão de "reativar automação" que já existe no CRM
-- continua funcionando pra destravar isso quando quiserem.
--
-- Default `true` = comportamento de hoje, pra campanha existente/futura sem
-- configurar isso não mudar em nada.

alter table public.whatsapp_campaigns
  add column if not exists continue_with_agent boolean not null default true;

comment on column public.whatsapp_campaigns.continue_with_agent is
  'false = manda só a mensagem inicial e pausa a automação (humano assume); true = agente de disparos continua atendendo quem responder.';
