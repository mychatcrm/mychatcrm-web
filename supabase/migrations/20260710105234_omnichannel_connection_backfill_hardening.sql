-- Harden legacy omnichannel attribution. A Meta rule may inherit a connection
-- only when the tenant has exactly one Evolution transport. Ambiguous tenants
-- require an explicit selection in Integracoes de Leads.

with single_connection as (
  select
    tenant_id,
    min(id::text) as connection_id
  from public.tenant_evolution_instances
  group by tenant_id
  having count(*) = 1
)
update public.lead_distribution_rules rule
   set connection_id = single_connection.connection_id,
       transport = 'evolution',
       updated_at = now()
  from single_connection
 where rule.tenant_id = single_connection.tenant_id
   and rule.source = 'meta_form'
   and nullif(trim(coalesce(rule.connection_id, '')), '') is null;

-- Replace the unsafe "first slot" attribution created by the original
-- backfill with the connection explicitly stored by its rule.
update public.lead_journeys journey
   set connection_id = rule.connection_id,
       updated_at = now(),
       metadata = coalesce(journey.metadata, '{}'::jsonb)
         || jsonb_build_object('connection_hardening_applied', true)
  from public.lead_distribution_rules rule
 where journey.rule_id = rule.id
   and journey.tenant_id = rule.tenant_id
   and journey.source = 'meta_form'
   and journey.metadata->>'backfilled' = 'true'
   and nullif(trim(coalesce(rule.connection_id, '')), '') is not null;

-- A historical journey without provable transport must never stay active. Its
-- messages remain available in CRM, but automatic replies wait for a manager
-- to select a connection on the rule.
with unsafe as (
  update public.lead_journeys journey
     set status = 'manual_review',
         connection_id = null,
         updated_at = now(),
         metadata = coalesce(journey.metadata, '{}'::jsonb)
           || jsonb_build_object(
             'connection_hardening_applied', true,
             'manual_review_reason', 'missing_or_ambiguous_meta_rule_connection'
           )
    from public.lead_distribution_rules rule
   where journey.rule_id = rule.id
     and journey.tenant_id = rule.tenant_id
     and journey.source = 'meta_form'
     and journey.metadata->>'backfilled' = 'true'
     and nullif(trim(coalesce(rule.connection_id, '')), '') is null
     and journey.status = 'active'
  returning journey.id, journey.tenant_id
)
update public.conversation_states state
   set active_journey_id = null,
       updated_at = now()
  from unsafe
 where state.tenant_id = unsafe.tenant_id
   and state.active_journey_id = unsafe.id;

notify pgrst, 'reload schema';
