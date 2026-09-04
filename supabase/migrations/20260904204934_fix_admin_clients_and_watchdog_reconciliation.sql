-- Keep the admin clients contract aligned with the normalized production
-- schema. Credentials and customer contact details remain service-role only.
create or replace function public.get_admin_clients_v1(
  p_search text default null,
  p_status text default null,
  p_plan text default null,
  p_limit integer default 500
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with normalized as (
    select
      tenant.id,
      tenant.name,
      coalesce(owner.email, '') as email,
      tenant.billing_plan as plan_slug,
      case
        when subscription.status = 'trialing' then 'trial'
        when tenant.status = 'ativa' then 'active'
        when tenant.status = 'suspensa' then 'suspended'
        when tenant.status = 'cancelada' then 'cancelled'
        else tenant.status
      end as normalized_status,
      tenant.created_at,
      subscription.customer_id as stripe_customer_id
    from public.tenants tenant
    left join lateral (
      select member.email
      from public.tenant_members member
      where member.tenant_id = tenant.id
      order by coalesce(member.is_owner, false) desc,
               coalesce(member.ativo, false) desc,
               member.created_at asc
      limit 1
    ) owner on true
    left join public.stripe_subscriptions subscription
      on subscription.tenant_id = tenant.id
  ), scoped as (
    select *
    from normalized row_data
    where (
      nullif(btrim(p_search), '') is null
      or row_data.name ilike '%' || btrim(p_search) || '%'
      or row_data.email ilike '%' || btrim(p_search) || '%'
      or row_data.plan_slug ilike '%' || btrim(p_search) || '%'
    )
      and (
        nullif(btrim(p_status), '') is null
        or lower(btrim(p_status)) = 'all'
        or row_data.normalized_status = lower(btrim(p_status))
      )
      and (
        nullif(btrim(p_plan), '') is null
        or lower(btrim(p_plan)) = 'all'
        or row_data.plan_slug = case lower(btrim(p_plan))
          when 'profissional' then 'equipa'
          when 'master' then 'escala'
          else lower(btrim(p_plan))
        end
      )
  ), page as (
    select * from scoped
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  )
  select jsonb_build_object(
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'name', page.name,
        'email', page.email,
        'planSlug', page.plan_slug,
        'status', page.normalized_status,
        'createdAt', page.created_at,
        'stripeCustomerId', page.stripe_customer_id
      ) order by page.created_at desc)
      from page
    ), '[]'::jsonb),
    'total', (select count(*) from scoped)
  );
$$;

revoke all on function public.get_admin_clients_v1(text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.get_admin_clients_v1(text,text,text,integer)
  to service_role;

-- A Vercel hard timeout can terminate the watchdog after `check.started` but
-- before `check.completed`. Preserve the immutable ledger and terminalize the
-- abandoned operation on the following scheduler cycle.
create or replace function private.reconcile_stale_watchdog_operations_v1()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  insert into public.operational_audit_events (
    operation_id, trace_id, tenant_id, actor_type, actor_id, module, action,
    resource_type, resource_id, status, severity, is_critical, channel,
    integration, duration_ms, attempt, result_code, idempotency_key,
    related_ids, metadata, deployment_sha
  )
  select
    operation.operation_id,
    operation.trace_id,
    operation.tenant_id,
    'system',
    'operational-audit-reconciler',
    'runtime.watchdog',
    'check.interrupted',
    operation.resource_type,
    operation.resource_id,
    'error',
    'error',
    true,
    operation.channel,
    operation.integration,
    greatest(0, least(2147483647,
      floor(extract(epoch from (now() - operation.started_at)) * 1000)
    )::integer),
    1,
    'watchdog_run_timed_out',
    'watchdog-timeout:' || operation.operation_id::text,
    '{}'::jsonb,
    jsonb_build_object(
      'reconciledOperation', true,
      'originalAction', operation.action,
      'originalStatus', operation.status
    ),
    operation.deployment_sha
  from public.operational_audit_operations operation
  where operation.module = 'runtime.watchdog'
    and operation.action = 'check.started'
    and operation.status = 'running'
    and operation.updated_at < now() - interval '10 minutes'
    and not exists (
      select 1
      from public.operational_audit_events existing
      where existing.idempotency_key = 'watchdog-timeout:' || operation.operation_id::text
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.reconcile_stale_watchdog_operations_v1()
  from public, anon, authenticated;
grant execute on function private.reconcile_stale_watchdog_operations_v1()
  to service_role;

-- Keep the scheduler connection open for the route's larger terminalization
-- budget. pg_net remains bounded below the 30-second Vercel function limit.
create or replace function private.dispatch_agent_runtime_watchdog_tick_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path constant text := '/api/internal/agent-runtime-watchdog/tick';
  v_secret text;
  v_timestamp text;
  v_nonce uuid := gen_random_uuid();
  v_signature text;
  v_request bigint;
begin
  select btrim(decrypted_secret) into v_secret
  from vault.decrypted_secrets
  where name = 'meta_leadgen_scheduler_secret'
  order by updated_at desc
  limit 1;

  if v_secret is null or octet_length(v_secret) < 32 then
    insert into private.agent_runtime_scheduler_dispatches(queue, nonce, status)
    values ('runtime_watchdog', v_nonce, 'config_missing');
    return null;
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_signature := encode(
    extensions.hmac(
      convert_to(concat_ws(E'\n', 'POST', v_path, v_timestamp, v_nonce::text), 'UTF8'),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select net.http_post(
    url := 'https://www.mychatcrm.com.br' || v_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-MyChatCRM-Timestamp', v_timestamp,
      'X-MyChatCRM-Nonce', v_nonce::text,
      'X-MyChatCRM-Signature', 'sha256=' || v_signature
    ),
    timeout_milliseconds := 25000
  ) into v_request;

  insert into private.agent_runtime_scheduler_dispatches(queue, nonce, request_id, status)
  values ('runtime_watchdog', v_nonce, v_request, 'queued');
  return v_request;
exception when others then
  insert into private.agent_runtime_scheduler_dispatches(queue, nonce, status)
  values ('runtime_watchdog', v_nonce, 'request_failed');
  return null;
end;
$$;

revoke all on function private.dispatch_agent_runtime_watchdog_tick_v1()
  from public, anon, authenticated;
grant execute on function private.dispatch_agent_runtime_watchdog_tick_v1()
  to service_role;

create or replace function private.run_agent_runtime_watchdog_v2()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reconcile_stale_watchdog_operations_v1();
  return private.dispatch_agent_runtime_watchdog_tick_v1();
end;
$$;

revoke all on function private.run_agent_runtime_watchdog_v2()
  from public, anon, authenticated;
grant execute on function private.run_agent_runtime_watchdog_v2()
  to service_role;

do $watchdog_cron$
declare v_job bigint;
begin
  if to_regnamespace('cron') is null then return; end if;
  for v_job in
    select jobid from cron.job
    where jobname = 'mychatcrm-agent-runtime-watchdog-five-minute'
  loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule(
    'mychatcrm-agent-runtime-watchdog-five-minute',
    '2-57/5 * * * *',
    'select private.run_agent_runtime_watchdog_v2();'
  );
end;
$watchdog_cron$;

-- Repair only stale watchdog bookkeeping left by previously killed runs. No
-- customer data, messages or jobs are changed.
select private.reconcile_stale_watchdog_operations_v1();
