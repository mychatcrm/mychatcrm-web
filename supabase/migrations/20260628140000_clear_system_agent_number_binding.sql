-- Limpa vínculo do número antigo do agente do sistema (wa_jid + metadata de webhook).

DELETE FROM public.tenant_evolution_instances
WHERE tenant_id = 'tenant-system-internal'
  AND slot_index = 0;

UPDATE public.tenant_agents
SET metadata = metadata
  - ARRAY[
      'system_webhook_last_messages_update_at',
      'system_webhook_last_messages_update_message_id',
      'system_webhook_last_messages_update_status',
      'system_webhook_last_messages_update_instance',
      'system_webhook_pending_delivery_events',
      'system_webhook_last_orphan_reconcile_at',
      'system_webhook_last_orphan_reconcile_applied',
      'system_webhook_last_orphan_reconcile_remaining'
    ],
  updated_at = now()
WHERE tenant_id = 'tenant-system-internal'
  AND agent_id = 'mychatcrm-system-agent';

NOTIFY pgrst, 'reload schema';
