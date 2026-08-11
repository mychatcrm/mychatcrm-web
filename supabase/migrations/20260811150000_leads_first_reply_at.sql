-- Marca da PRIMEIRA resposta do lead.
--
-- Sem isso não dá para oferecer "mover o card quando o lead responder" sem
-- atropelar a equipe: cada mensagem nova do lead puxaria o card de volta para a
-- coluna configurada, desfazendo qualquer movimentação manual feita depois.
--
-- Com o carimbo, reivindicá-lo vira uma escrita condicional
-- (`update ... where first_reply_at is null`), que é atômica no Postgres: mesmo
-- com duas mensagens chegando ao mesmo tempo, só uma ganha e o card é movido
-- uma única vez. Ver `applyCrmMoveOnFirstLeadReply` em
-- `lib/server/agent-crm-move.ts`.
--
-- NULL de propósito e sem default: leads que já existem ficam sem carimbo, e a
-- próxima resposta deles conta como a primeira. É o comportamento desejado —
-- a funcionalidade é nova e ninguém tinha destino configurado antes deste
-- deploy, então nada se move sem o dono da conta ligar a opção no agente.

alter table public.leads
  add column if not exists first_reply_at timestamptz null;

comment on column public.leads.first_reply_at is
  'Quando o lead respondeu pela primeira vez a um agente. NULL = ainda não respondeu. Usado como trava idempotente do move de CRM na primeira resposta.';

-- O move só consulta esta coluna para leads de um tenant específico, e apenas
-- quando ainda está nula. O índice parcial mantém isso barato sem custar
-- escrita nos leads que já responderam.
create index if not exists leads_tenant_pending_first_reply_idx
  on public.leads (tenant_id)
  where first_reply_at is null;
