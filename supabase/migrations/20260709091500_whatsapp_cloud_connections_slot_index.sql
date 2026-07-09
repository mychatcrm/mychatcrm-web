-- Torna whatsapp_cloud_connections multi-linha por tenant, no mesmo molde de
-- tenant_evolution_instances (tenant_id, slot_index). Linhas existentes (uma
-- por tenant hoje) ficam na linha 0 — comportamento actual preservado.
alter table public.whatsapp_cloud_connections
  add column if not exists slot_index integer not null default 0;

alter table public.whatsapp_cloud_connections
  add constraint whatsapp_cloud_connections_tenant_slot_uniq unique (tenant_id, slot_index);
