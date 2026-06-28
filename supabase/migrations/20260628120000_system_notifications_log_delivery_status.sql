-- Permite status de entrega real (webhook) e UPDATE pelo service_role.
-- Corrige bug: migration original só permitia sent/failed e não concedia UPDATE.

ALTER TABLE public.system_notifications_log
  DROP CONSTRAINT IF EXISTS system_notifications_log_status_check;

ALTER TABLE public.system_notifications_log
  ADD CONSTRAINT system_notifications_log_status_check
  CHECK (status IN ('sent', 'failed', 'delivered', 'delivery_failed', 'skipped', 'pending'));

GRANT UPDATE ON TABLE public.system_notifications_log TO service_role;
