-- CRM como memória canônica: visibilidade de conversas + vínculo forte com lead

alter table public.conversation_states
  add column if not exists is_hidden boolean not null default false,
  add column if not exists archived_at timestamptz null,
  add column if not exists hidden_at timestamptz null,
  add column if not exists hidden_by text null;

create index if not exists conversation_states_tenant_visible_idx
  on public.conversation_states (tenant_id, channel, is_hidden, archived_at);

comment on column public.conversation_states.is_hidden is
  'Oculta do inbox /dashboard/conversas sem apagar histórico CRM.';
comment on column public.conversation_states.archived_at is
  'Arquivada no painel; memória central permanece no CRM.';

alter table public.whatsapp_messages
  add column if not exists lead_id uuid null references public.leads(id) on delete set null;

create index if not exists whatsapp_messages_tenant_lead_idx
  on public.whatsapp_messages (tenant_id, lead_id);

create index if not exists whatsapp_messages_tenant_jid_created_idx
  on public.whatsapp_messages (tenant_id, remote_jid, created_at desc);
