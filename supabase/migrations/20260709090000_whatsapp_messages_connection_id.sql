-- Identifica QUAL das linhas de WhatsApp do tenant (pode ter várias QR Code e
-- várias API Meta) processou cada mensagem — necessário para o filtro por
-- número em /dashboard/conversas. Para linhas QR, guarda o UUID de
-- tenant_evolution_instances.id; para linhas Meta, o phone_number_id.
-- Nullable: linhas anteriores a esta migration ficam sem conexão conhecida e
-- só aparecem no filtro "Todos os números".
alter table public.whatsapp_messages
  add column if not exists connection_id text;
