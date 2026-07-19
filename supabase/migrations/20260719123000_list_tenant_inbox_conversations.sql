-- Inbox Conversas: última mensagem por remote_jid sem varrer milhares de linhas.
-- tenant_id em whatsapp_messages é text (não uuid).
create or replace function public.list_tenant_inbox_conversations(
  p_tenant_id text,
  p_connection_id text default null
)
returns table (
  remote_jid text,
  last_content text,
  last_kind text,
  last_direction text,
  last_at timestamptz,
  connection_id text,
  channel text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.remote_jid)
    m.remote_jid,
    m.content,
    m.kind,
    m.direction,
    m.created_at,
    m.connection_id,
    m.channel::text
  from public.whatsapp_messages m
  where m.tenant_id = p_tenant_id
    and (
      p_connection_id is null
      or btrim(p_connection_id) = ''
      or m.connection_id = p_connection_id
    )
  order by m.remote_jid, m.created_at desc;
$$;

revoke all on function public.list_tenant_inbox_conversations(text, text) from public;
grant execute on function public.list_tenant_inbox_conversations(text, text) to service_role;

comment on function public.list_tenant_inbox_conversations(text, text) is
  'Última mensagem por conversa (remote_jid) para a inbox /api/client/conversas.';
