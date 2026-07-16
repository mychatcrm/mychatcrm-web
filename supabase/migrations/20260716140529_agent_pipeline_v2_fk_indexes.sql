-- Índices de cobertura para as FKs introduzidas pelo pipeline v2, alinhados
-- à versão registrada no histórico remoto. Além de
-- remover os avisos do advisor, evitam varreduras completas em exclusões ou
-- atualizações dos registros pai.

CREATE INDEX IF NOT EXISTS agenda_sync_outbox_event_idx
  ON public.agenda_sync_outbox (agenda_event_id);

CREATE INDEX IF NOT EXISTS agent_agenda_pending_actions_event_idx
  ON public.agent_agenda_pending_actions (event_id);

CREATE INDEX IF NOT EXISTS agent_agenda_pending_actions_source_job_idx
  ON public.agent_agenda_pending_actions (source_job_id);

CREATE INDEX IF NOT EXISTS agent_outbound_outbox_lead_idx
  ON public.agent_outbound_outbox (lead_id);
