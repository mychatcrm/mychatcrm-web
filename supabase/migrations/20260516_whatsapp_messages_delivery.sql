-- Outbound delivery tracking + client reconciliation for optimistic UI

alter table public.whatsapp_messages
  add column if not exists delivery_status text null default 'sent',
  add column if not exists client_temp_id text null,
  add column if not exists failed_reason text null,
  add column if not exists sent_at timestamptz null;

create index if not exists whatsapp_messages_tenant_client_temp_idx
  on public.whatsapp_messages (tenant_id, client_temp_id)
  where client_temp_id is not null;

comment on column public.whatsapp_messages.delivery_status is
  'pending | sent | failed — principalmente para outbound humano.';
comment on column public.whatsapp_messages.client_temp_id is
  'Id temporário do cliente para reconciliar UI otimista com o registro real.';
