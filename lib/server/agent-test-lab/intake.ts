import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Ordinary tenants take no extra database/network path. Lab receivers are closed
 * to unsolicited contacts, old phone syncs and messages after a run has stopped. */
export async function acceptsLabReceiverMessage(params: {
  tenantId: string; connectionId: string; instanceName: string;
  remoteJid: string; providerTime: string | null | undefined; messageId: string | null | undefined;
}): Promise<boolean> {
  const labInstance = params.instanceName.startsWith("mychatcrm-lab-receiver-");
  const labTenant = params.tenantId.startsWith("tenant-lab-");
  if (!labInstance && !labTenant) return true;
  if (!labInstance || !labTenant || !params.messageId || !params.providerTime ||
    !Number.isFinite(Date.parse(params.providerTime))) return false;
  if (process.env.AGENT_TEST_LAB_ENABLED !== "true") return false;
  const result = await createSupabaseServiceClient().rpc("authorize_agent_test_lab_inbound_v3", {
    p_tenant: params.tenantId, p_connection: params.connectionId, p_instance: params.instanceName,
    p_remote_jid: params.remoteJid, p_occurred_at: params.providerTime,
  });
  if (result.error) throw new Error("lab_inbound_authorization_unavailable");
  return result.data === true;
}
