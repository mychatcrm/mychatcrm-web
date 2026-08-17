-- Campanha passa a aceitar vários públicos combinados na mesma campanha
-- (CRM + lista importada + contatos digitados, quantos blocos o cliente
-- quiser). audience_type/audience_config continuam existindo como resumo
-- legível quando dá pra resumir num único filtro; audience_blocks guarda a
-- configuração completa sempre, para não perder informação quando a
-- campanha combina mais de um público.

alter table public.whatsapp_campaigns
  add column if not exists audience_blocks jsonb not null default '[]'::jsonb;

comment on column public.whatsapp_campaigns.audience_blocks is
  'Públicos combinados nesta campanha: [{ kind: "crm", filter, value } | { kind: "leads", leadIds }].';

alter table public.whatsapp_campaigns
  drop constraint if exists whatsapp_campaigns_audience_type_check;

alter table public.whatsapp_campaigns
  add constraint whatsapp_campaigns_audience_type_check
    check (audience_type in ('all', 'tag', 'funnel_stage', 'custom'));
