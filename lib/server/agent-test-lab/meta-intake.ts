import "server-only";
import type { WhatsAppInboundMessage } from "@/lib/integrations/whatsapp-cloud";
import { LAB_OWNER_ID, labPhoneJid } from "@/lib/agent-test-lab/policy";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

/** Captures replies delivered to the Meta Cloud tester line before the normal
 * customer/system routers see them. Returns true only when the payload belonged
 * to the currently active laboratory run. */
export async function captureMetaLabSenderInbound(inbound: WhatsAppInboundMessage): Promise<boolean> {
  if (process.env.AGENT_TEST_LAB_ENABLED !== "true" || !inbound.messageId) return false;
  const sb = createSupabaseServiceClient();
  const sender = await sb.from("agent_test_lab_connections").select("id")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "sender").eq("provider", "meta_cloud")
    .eq("phone_number_id", inbound.phoneNumberId).eq("state", "open").is("archived_at", null).maybeSingle();
  if (sender.error) throw new Error("lab_meta_sender_read_failed");
  if (!sender.data) return false;
  const run = await sb.from("agent_test_lab_runs")
    .select("id,trace_id,target_jid,target_tenant_id,target_connection_id,target_channel,created_at,deadline_at")
    .eq("sender_connection_id", sender.data.id)
    .in("status", ["running", "paused", "waiting_reply", "waiting_input"]).maybeSingle();
  if (run.error) throw new Error("lab_meta_run_read_failed");
  if (!run.data) return true;
  const sourceJid = labPhoneJid(inbound.fromWaId);
  const occurredAt = inbound.providerOccurredAt ?? new Date().toISOString();
  if (!sourceJid || sourceJid !== run.data.target_jid || Date.parse(occurredAt) < Date.parse(run.data.created_at)
    || Date.parse(occurredAt) > Date.parse(run.data.deadline_at)) return true;
  const destination = await sb.from("agent_test_lab_destinations").select("id")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("tenant_id", run.data.target_tenant_id)
    .eq("connection_id", run.data.target_connection_id).eq("channel", run.data.target_channel)
    .eq("target_jid", run.data.target_jid).is("revoked_at", null).maybeSingle();
  if (destination.error) throw new Error("lab_meta_destination_read_failed");
  if (!destination.data) return true;
  const saved = await sb.from("agent_test_lab_messages").upsert({
    run_id: run.data.id,
    direction: "agent",
    kind: inbound.kind,
    content: inbound.text.slice(0, 20_000) || null,
    provider_message_id: inbound.messageId,
    provider_occurred_at: occurredAt,
  }, { onConflict: "run_id,direction,provider_message_id", ignoreDuplicates: true }).select("id");
  if (saved.error) throw new Error("lab_meta_message_save_failed");
  if (saved.data?.length) await appendOperationalAuditEvent({
    traceId: run.data.trace_id,
    actorType: "webhook",
    module: "agent.test_lab",
    action: "inbound.persisted",
    status: "completed",
    resourceType: "agent_test_lab_run",
    resourceId: run.data.id,
    relatedIds: { runId: run.data.id },
    metadata: { count: saved.data.length, provider: "meta_cloud" },
  });
  return true;
}

/** Closes the isolated Meta answering line to every contact except the tester
 * bound to the current run. */
export async function acceptsMetaLabReceiverInbound(params: {
  tenantId: string;
  phoneNumberId: string;
  remoteJid: string;
  messageId: string;
  providerTime: string;
}): Promise<boolean> {
  if (!params.tenantId.startsWith("tenant-lab-") || process.env.AGENT_TEST_LAB_ENABLED !== "true") return false;
  const sb = createSupabaseServiceClient();
  const receiver = await sb.from("agent_test_lab_connections").select("instance_name")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "receiver").eq("provider", "meta_cloud")
    .eq("phone_number_id", params.phoneNumberId).eq("state", "open").is("archived_at", null).maybeSingle();
  if (receiver.error) throw new Error("lab_meta_receiver_read_failed");
  if (!receiver.data || !params.messageId || !Number.isFinite(Date.parse(params.providerTime))) return false;
  const authorized = await sb.rpc("authorize_agent_test_lab_inbound_v3", {
    p_tenant: params.tenantId,
    p_connection: params.phoneNumberId,
    p_instance: receiver.data.instance_name,
    p_remote_jid: params.remoteJid,
    p_occurred_at: params.providerTime,
  });
  if (authorized.error) throw new Error("lab_inbound_authorization_unavailable");
  return authorized.data === true;
}
