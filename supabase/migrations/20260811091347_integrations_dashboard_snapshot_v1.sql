-- One tenant-scoped, secret-free database snapshot for dashboard/integracoes.
-- The browser never calls this function directly. The authenticated Next.js
-- server uses service_role and adds session-derived permissions/plan limits.

create or replace function public.get_integrations_dashboard_snapshot_v1(
  p_tenant_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with active_entitlements as (
    select
      entitlement.kind,
      entitlement.billing_mode,
      entitlement.quantity,
      entitlement.source
    from public.tenant_billing_entitlements as entitlement
    where entitlement.tenant_id = p_tenant_id
      and entitlement.status in ('active', 'scheduled_cancel')
      and entitlement.valid_from <= now()
      and (entitlement.valid_until is null or entitlement.valid_until >= now())
  ),
  whatsapp_entitlements as (
    select
      coalesce(sum(quantity) filter (
        where kind = 'whatsapp_line' and billing_mode = 'recurring'
      ), 0)::integer as entitled_slots,
      coalesce(bool_or(
        kind = 'whatsapp_line'
        and billing_mode = 'recurring'
        and source = 'legacy_backfill'
      ), false) as has_legacy_mirror
    from active_entitlements
  ),
  legacy_whatsapp as (
    select coalesce(max(extra_whatsapp_slots), 0)::integer as extra_slots
    from public.stripe_subscriptions
    where tenant_id = p_tenant_id
  ),
  api_entitlements as (
    select coalesce(sum(quantity) filter (
      where kind = 'api_connector' and billing_mode = 'recurring'
    ), 0)::integer as purchased
    from active_entitlements
  )
  select jsonb_build_object(
    'version', 1,
    'generated_at', now(),
    'whatsapp', jsonb_build_object(
      'extra_slots', greatest(
        0,
        whatsapp_entitlements.entitled_slots
        + case when whatsapp_entitlements.has_legacy_mirror then 0 else legacy_whatsapp.extra_slots end
      ),
      'offer', coalesce((
        select jsonb_build_object(
          'amount_cents', catalog.amount_cents,
          'currency', catalog.currency,
          'interval_unit', catalog.interval_unit
        )
        from public.billing_addon_catalog as catalog
        where catalog.kind = 'whatsapp_line'
          and catalog.billing_mode = 'recurring'
          and catalog.active = true
        order by (catalog.code = 'whatsapp_line_recurring') desc, catalog.created_at
        limit 1
      ), 'null'::jsonb),
      'slot_states', coalesce((
        select jsonb_agg(jsonb_build_object(
          'slot_index', slot.slot_index,
          'active_provider', slot.active_provider,
          'purpose', slot.purpose,
          'updated_at', slot.updated_at
        ) order by slot.slot_index)
        from public.tenant_whatsapp_slot_state as slot
        where slot.tenant_id = p_tenant_id
      ), '[]'::jsonb),
      'evolution', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', instance.id,
          'slot_index', instance.slot_index,
          'instance_name', instance.instance_name,
          'connection_state', instance.connection_state,
          'wa_jid', instance.wa_jid,
          'updated_at', instance.updated_at
        ) order by instance.slot_index)
        from public.tenant_evolution_instances as instance
        where instance.tenant_id = p_tenant_id
      ), '[]'::jsonb),
      'cloud', coalesce((
        select jsonb_agg(jsonb_build_object(
          'phone_number_id', cloud.phone_number_id,
          'slot_index', cloud.slot_index,
          'display_phone', cloud.display_phone,
          'verified_name', cloud.verified_name,
          'active', cloud.active,
          'connected_at', cloud.connected_at,
          'updated_at', cloud.updated_at
        ) order by cloud.slot_index)
        from public.whatsapp_cloud_connections as cloud
        where cloud.tenant_id = p_tenant_id
          and cloud.active = true
      ), '[]'::jsonb)
    ),
    'meta', jsonb_build_object(
      'grant', coalesce((
        select jsonb_build_object(
          'discovery_status', grant_row.discovery_status,
          'last_error_code', grant_row.last_error_code,
          'last_discovered_at', grant_row.last_discovered_at,
          'updated_at', grant_row.updated_at
        )
        from public.meta_lead_grants as grant_row
        where grant_row.tenant_id = p_tenant_id
      ), 'null'::jsonb),
      'pages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'page_id', connection.page_id,
          'page_name', connection.page_name,
          'connected_at', connection.connected_at,
          'health_status', connection.health_status,
          'health_code', connection.health_code,
          'health_message', connection.health_message,
          'lead_access_status', connection.lead_access_status,
          'last_lead_access_verified_at', connection.last_lead_access_verified_at,
          'last_verified_at', connection.last_verified_at,
          'last_webhook_at', connection.last_webhook_at,
          'subscribed_fields', connection.subscribed_fields
        ) order by connection.connected_at)
        from public.meta_connections as connection
        where connection.tenant_id = p_tenant_id
      ), '[]'::jsonb),
      'rules', coalesce((
        select jsonb_agg(jsonb_build_object(
          'page_id', rule.page_id,
          'use_all_forms', rule.use_all_forms,
          'included_form_ids', rule.included_form_ids,
          'excluded_form_ids', rule.excluded_form_ids,
          'agent_ids', rule.agent_ids,
          'order_index', rule.order_index
        ) order by rule.order_index)
        from public.lead_distribution_rules as rule
        where rule.tenant_id = p_tenant_id
          and rule.source = 'meta_form'
          and rule.active = true
      ), '[]'::jsonb),
      'form_mappings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'page_id', mapping.page_id,
          'form_id', mapping.form_id,
          'form_name', mapping.form_name,
          'agent_id', mapping.agent_id
        ) order by mapping.created_at)
        from public.meta_form_agent_mapping as mapping
        where mapping.tenant_id = p_tenant_id
      ), '[]'::jsonb)
    ),
    'external_apis', jsonb_build_object(
      'purchased', api_entitlements.purchased,
      'used', (
        select count(*)::integer
        from public.external_api_connectors as connector_count
        where connector_count.tenant_id = p_tenant_id
      ),
      'connectors', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', connector.id,
          'name', connector.name,
          'description', connector.description,
          'base_url', connector.base_url,
          'auth_type', connector.auth_type,
          'auth_header_name', connector.auth_header_name,
          'auth_username', connector.auth_username,
          'credential_configured', connector.credential_ciphertext is not null,
          'enabled', connector.enabled,
          'is_primary', connector.is_primary,
          'health_status', connector.health_status,
          'last_health_at', connector.last_health_at,
          'last_error_code', connector.last_error_code,
          'operation_count', (
            select count(*)::integer
            from public.external_api_operations as operation
            where operation.tenant_id = p_tenant_id
              and operation.connector_id = connector.id
          ),
          'agent_count', (
            select count(*)::integer
            from public.agent_external_api_connectors as link
            where link.tenant_id = p_tenant_id
              and link.connector_id = connector.id
          ),
          'created_at', connector.created_at,
          'updated_at', connector.updated_at
        ) order by connector.is_primary desc, connector.created_at)
        from public.external_api_connectors as connector
        where connector.tenant_id = p_tenant_id
      ), '[]'::jsonb)
    )
  )
  from whatsapp_entitlements, legacy_whatsapp, api_entitlements;
$function$;

revoke all on function public.get_integrations_dashboard_snapshot_v1(text) from public;
revoke all on function public.get_integrations_dashboard_snapshot_v1(text) from anon;
revoke all on function public.get_integrations_dashboard_snapshot_v1(text) from authenticated;
grant execute on function public.get_integrations_dashboard_snapshot_v1(text) to service_role;

comment on function public.get_integrations_dashboard_snapshot_v1(text) is
  'Secret-free, DB-only snapshot for the authenticated integrations dashboard. Service role only.';
