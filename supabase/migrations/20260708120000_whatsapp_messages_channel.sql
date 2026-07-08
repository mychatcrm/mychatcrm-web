-- Identifica por qual canal cada mensagem passou (QR Code/Evolution ou API
-- Oficial Meta) — necessário para o painel "Conversas ao vivo" do agente do
-- sistema filtrar por número, já que o mesmo agente atende por 2 números.
-- Nullable: linhas anteriores a esta migration ficam sem canal conhecido e só
-- aparecem no filtro "Todas".
alter table public.whatsapp_messages
  add column if not exists channel text
  check (channel is null or channel = any (array['evolution', 'meta_cloud']));
