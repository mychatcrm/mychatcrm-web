-- Finalidade de cada linha WhatsApp: formulários Meta OU WhatsApp direto.
--
-- Sem isso, uma regra de formulário e uma regra de atendimento direto podem
-- apontar para a mesma conexão, e o mesmo número acaba servindo às duas coisas.
-- Com a finalidade travada, o wizard de regras só oferece linhas compatíveis e
-- a API recusa a combinação errada (ver `lib/server/lead-rules-line-purpose.ts`).
--
-- `purpose` é NULL de propósito e sem default: NULL significa "livre" e mantém
-- exatamente o comportamento anterior, para que nenhum tenant já configurado
-- mude de comportamento no deploy. A trava só passa a valer numa linha depois
-- que o operador escolhe a finalidade dela em Integrações → WhatsApp.

alter table public.tenant_whatsapp_slot_state
  add column if not exists purpose text null;

alter table public.tenant_whatsapp_slot_state
  drop constraint if exists tenant_whatsapp_slot_state_purpose_check;

alter table public.tenant_whatsapp_slot_state
  add constraint tenant_whatsapp_slot_state_purpose_check
  check (purpose is null or purpose in ('forms', 'direct'));

comment on column public.tenant_whatsapp_slot_state.purpose is
  'Finalidade travada da linha: forms = formulários Meta, direct = WhatsApp direto, NULL = livre (sem restrição).';
