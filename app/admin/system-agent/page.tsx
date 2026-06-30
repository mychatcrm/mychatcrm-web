import { redirect } from "next/navigation";
import { SystemAgentHub, type SystemNotificationLogItem } from "@/components/admin/SystemAgentHub";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import {
  SYSTEM_AGENT_ID,
  SYSTEM_TENANT_ID,
  getSystemAgentInstanceName,
  getSystemAgentMetaConfig,
} from "@/lib/server/system-agent";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SystemAgentAdminPage() {
  const session = await getAdminSessionFromCookies();
  if (!session) redirect("/admin/login");
  if (!hasAdminAccess(session, "system-agent")) redirect("/admin");

  const sb = createSupabaseServiceClient();
  const [instance, metaConfigRaw] = await Promise.all([
    getEvolutionInstanceByTenantId(SYSTEM_TENANT_ID),
    getSystemAgentMetaConfig(),
  ]);
  const instanceName = instance?.instance_name ?? (await getSystemAgentInstanceName());

  const { data: logs } = await sb
    .from("system_notifications_log")
    .select("id, type, to_number, message, status, error, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  const initialMetaConfig = metaConfigRaw
    ? {
        active: metaConfigRaw.active,
        phone_number_id: metaConfigRaw.phoneNumberId,
        display_phone: metaConfigRaw.displayPhone,
        verified_name: metaConfigRaw.verifiedName,
      }
    : null;

  return (
    <SystemAgentHub
      agentId={SYSTEM_AGENT_ID}
      tenantId={SYSTEM_TENANT_ID}
      instanceName={instanceName}
      connectionState={instance?.connection_state ?? "none"}
      waJid={instance?.wa_jid ?? null}
      initialLogs={(logs ?? []) as SystemNotificationLogItem[]}
      initialMetaConfig={initialMetaConfig}
    />
  );
}
