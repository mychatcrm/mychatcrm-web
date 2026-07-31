-- Equipe dona da lista de ligação.
--
-- Sem esta coluna, qualquer diretor ou gerente enxergava as listas de toda a
-- conta — inclusive de outra equipe — e ao abrir uma lista os leads de dentro
-- vinham junto. Fecha a mesma fronteira que já valia para lead, conversa e
-- agenda.
--
-- A equipe é derivada dos leads que entram na lista (lib/server/active-offers-team.ts),
-- não escolhida à mão: quem monta a lista já está limitado ao próprio escopo.
-- Lista com leads de equipes diferentes fica sem equipe e visível só ao titular.

alter table public.active_offers
  add column if not exists team_id uuid null references public.teams(id) on delete set null;

create index if not exists active_offers_tenant_team_idx
  on public.active_offers (tenant_id, team_id);

comment on column public.active_offers.team_id is
  'Equipe dona da lista. Null = sem equipe: visivel ao titular e a quem criou.';
