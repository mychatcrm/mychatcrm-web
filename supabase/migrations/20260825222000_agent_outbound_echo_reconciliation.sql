-- Reconcile a provider echo that arrives before the sender worker has time to
-- persist its receipt. Exact tenant/connection/contact and a currently claimed,
-- authorized outbox are mandatory; otherwise the webhook keeps treating the
-- outbound as a genuine human message.

create index if not exists agent_outbound_outbox_evolution_echo_idx
  on public.agent_outbound_outbox (
    tenant_id,
    connection_id,
    remote_jid,
    updated_at desc
  )
  where channel = 'evolution'
    and status = 'processing'
    and claim_token is not null;

create or replace function public.reconcile_agent_outbound_echo_v1(
  p_tenant_id text,
  p_connection_id text,
  p_remote_jid text,
  p_provider_message_id text,
  p_kind text,
  p_content text,
  p_provider_remote_jid text,
  p_provider_status text,
  p_delivery_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_out public.agent_outbound_outbox%rowtype;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_tenant_id, '')), '') is null
     or nullif(btrim(coalesce(p_connection_id, '')), '') is null
     or nullif(btrim(coalesce(p_remote_jid, '')), '') is null
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or p_kind not in ('text', 'audio', 'image', 'video', 'document') then
    return jsonb_build_object('ok', false, 'matched', false, 'reason', 'echo_identity_invalid');
  end if;

  select * into v_out
    from public.agent_outbound_outbox o
   where o.tenant_id = p_tenant_id
     and o.channel = 'evolution'
     and o.connection_id = p_connection_id
     and o.remote_jid = p_remote_jid
     and o.status = 'processing'
     and o.claim_token is not null
     and o.claim_expires_at > now()
     and o.authorization_status = 'authorized'
     and o.updated_at >= now() - interval '2 minutes'
     and (
       o.kind = p_kind
       or (o.kind = 'template' and p_kind = 'text')
     )
     and (
       p_kind <> 'text'
       or left(coalesce(o.content, ''), 4000) = left(coalesce(p_content, ''), 4000)
     )
   order by o.updated_at desc
   limit 1
   for update;

  if v_out.id is null then
    return jsonb_build_object('ok', true, 'matched', false, 'reason', 'automatic_echo_not_found');
  end if;

  select public.finalize_agent_outbound_delivery_v1(
    v_out.id,
    v_out.claim_token,
    p_provider_message_id,
    p_kind,
    v_out.content,
    p_provider_remote_jid,
    p_provider_status,
    p_delivery_status,
    null
  ) into v_result;

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'matched', true,
      'reason', coalesce(v_result ->> 'reason', 'echo_finalize_failed')
    );
  end if;

  return v_result || jsonb_build_object('matched', true, 'reason', 'automatic_echo_reconciled');
end;
$fn$;

revoke all on function public.reconcile_agent_outbound_echo_v1(
  text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.reconcile_agent_outbound_echo_v1(
  text,text,text,text,text,text,text,text,text
) to service_role;

comment on function public.reconcile_agent_outbound_echo_v1(
  text,text,text,text,text,text,text,text,text
) is 'Atomically adopts an early Evolution provider echo into an authorized automatic outbox before human takeover classification.';
