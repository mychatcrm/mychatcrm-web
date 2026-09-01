-- Reconcile legacy watchdog starts that were interrupted before a terminal
-- event could be written. The append-only ledger is preserved: reconciliation
-- is represented by a new terminal event for the original operation.

insert into public.operational_audit_events (
  operation_id,
  trace_id,
  tenant_id,
  actor_type,
  actor_id,
  module,
  action,
  resource_type,
  resource_id,
  status,
  severity,
  is_critical,
  channel,
  integration,
  duration_ms,
  attempt,
  result_code,
  idempotency_key,
  related_ids,
  metadata,
  deployment_sha
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
  greatest(
    0,
    least(
      2147483647,
      floor(extract(epoch from (now() - operation.started_at)) * 1000)
    )::integer
  ),
  greatest(started.attempt, 1),
  'legacy_watchdog_run_interrupted',
  'legacy-watchdog-interrupted:' || operation.operation_id::text,
  coalesce(started.related_ids, '{}'::jsonb),
  jsonb_build_object(
    'reconciledLegacyOperation', true,
    'originalAction', operation.action,
    'originalStatus', operation.status
  ),
  operation.deployment_sha
from public.operational_audit_operations operation
join lateral (
  select event.attempt, event.related_ids
  from public.operational_audit_events event
  where event.operation_id = operation.operation_id
  order by event.occurred_at desc, event.id desc
  limit 1
) started on true
where operation.module = 'runtime.watchdog'
  and operation.action = 'check.started'
  and operation.status = 'running'
  and operation.updated_at < now() - interval '10 minutes'
  and not exists (
    select 1
    from public.operational_audit_events existing
    where existing.idempotency_key =
      'legacy-watchdog-interrupted:' || operation.operation_id::text
  );
