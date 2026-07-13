-- Keep the provider receipt separate from message_id, which is also used for
-- inbound deduplication and Meta Lead Ads idempotency.
alter table public.whatsapp_messages
  add column if not exists provider_message_id text,
  add column if not exists provider_remote_jid text,
  add column if not exists provider_status text,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;

create unique index if not exists whatsapp_messages_evolution_receipt_uidx
  on public.whatsapp_messages (tenant_id, connection_id, provider_message_id)
  where provider_message_id is not null and connection_id is not null;

create index if not exists whatsapp_messages_provider_message_lookup_idx
  on public.whatsapp_messages (tenant_id, provider_message_id)
  where provider_message_id is not null;

comment on column public.whatsapp_messages.provider_message_id is
  'ID real devolvido pelo provedor (Evolution/Baileys) para reconciliar ACKs.';
comment on column public.whatsapp_messages.provider_remote_jid is
  'JID efetivamente resolvido pelo provedor no envio.';
comment on column public.whatsapp_messages.provider_status is
  'Status bruto mais recente informado pelo provedor.';
comment on column public.whatsapp_messages.delivery_status is
  'pending | sent | delivered | read | failed.';
