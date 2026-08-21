-- Disparo vira algo que o cliente controla: salva, dá play quando quiser,
-- pausa no meio e retoma de onde parou.
--
-- Antes, criar a campanha já começava a disparar na hora — não havia como
-- preparar um disparo e mandar depois, nem segurar no meio. Agora:
--   draft    → salva e espera. É o estado de quem acabou de criar.
--   scheduled→ o cliente deu play; o processador pega na próxima passada.
--   processing→ enviando.
--   paused   → segurou no meio. Os destinatários pendentes continuam
--              pendentes, então o play seguinte retoma exatamente da fila
--              que estava — sem reenviar pra quem já recebeu.
--
-- `display_order` guarda a ordem escolhida a dedo pelo cliente na tela
-- (arrastando os cards). NULL = nunca reordenado; a listagem cai em
-- created_at nesse caso.

alter table public.whatsapp_campaigns
  drop constraint if exists whatsapp_campaigns_status_check;

alter table public.whatsapp_campaigns
  add constraint whatsapp_campaigns_status_check
    check (status in ('draft', 'scheduled', 'processing', 'paused', 'completed', 'cancelled', 'failed'));

alter table public.whatsapp_campaigns
  add column if not exists display_order integer;

comment on column public.whatsapp_campaigns.display_order is
  'Ordem escolhida pelo cliente arrastando os cards. NULL = nunca reordenado (cai em created_at).';
