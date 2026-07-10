-- Ritmo de envio real (mensagens/minuto, não decorativo) e template Meta
-- aprovado (obrigatório pra mensagem iniciada pela empresa fora da janela de
-- 24h — texto livre é descartado pela Meta com erro 131047 nesse caso).
-- meta_template_name/meta_template_lang só são usados quando
-- whatsapp_campaigns.transport = 'cloud_api'.
alter table public.whatsapp_campaigns
  add column if not exists throughput text not null default 'normal'
    check (throughput in ('suave', 'normal', 'acelerado')),
  add column if not exists meta_template_name text null,
  add column if not exists meta_template_lang text null;
