-- Destino do lead ao entrar num disparo, escolhido por campanha.
--
-- A troca do agente de IA (leads.agent_id) já acontece sempre, automática —
-- é a isolação do agente de disparos, que já está em produção. O que faltava
-- era o dono da conta poder escolher, por campanha: mover o lead pra outro
-- funil/coluna, e/ou soltar o vendedor humano responsável (owner_employee_id).
--
-- Mesmo molde de `send_window`: jsonb com default vazio, parser dedicado
-- (`parseCampaignLeadDestination`) decide o que fazer, campanha sem config
-- continua com o comportamento de hoje (não mexe em funil/coluna/dono).

alter table public.whatsapp_campaigns
  add column if not exists lead_destination jsonb not null default '{}'::jsonb;

comment on column public.whatsapp_campaigns.lead_destination is
  'Destino do lead ao entrar no disparo: { moveToFunnel, funnelId, columnId, releaseOwner }. Vazio = não mexe em funil/coluna/dono.';
