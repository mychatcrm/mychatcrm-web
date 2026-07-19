-- Templates Meta aprovados para o 1º contacto Lead Ads via Cloud API.
alter table public.lead_distribution_rules
  add column if not exists meta_template_name text null,
  add column if not exists meta_template_lang text null;

comment on column public.lead_distribution_rules.meta_template_name is
  'Nome do template WhatsApp Cloud aprovado para outreach inicial (Lead Ads) quando transport=cloud_api.';
comment on column public.lead_distribution_rules.meta_template_lang is
  'Código de idioma do template Meta (ex.: pt_BR).';
