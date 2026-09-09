import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { evolutionSendText, evolutionWaitForMessageStatus, jidToDigits } from "@/lib/integrations/evolution-api";
import { extractEvolutionSendReceipt } from "@/lib/integrations/evolution-message-receipt";
import { LAB_INSTANCE_PREFIX, LAB_OWNER_ID, labPhoneJid } from "@/lib/agent-test-lab/policy";
import { getLabSender } from "./connections";

export type LabDispatch =
  | { outcome: "confirmed"; providerMessageId: string; deliveryStatus: string | null }
  | { outcome: "inconclusive"; code: string; providerMessageId: string | null }
  | { outcome: "rejected"; code: string };

/**
 * The destination is re-read from the authorized catalogue immediately before the
 * call, so a revocation between queueing and sending still stops the message.
 */
export async function assertLabDestinationAuthorized(params: {
  tenantId: string; connectionId: string; channel: string; targetJid: string;
}): Promise<boolean> {
  const result = await createSupabaseServiceClient()
    .from("agent_test_lab_destinations").select("id")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("tenant_id", params.tenantId)
    .eq("connection_id", params.connectionId).eq("channel", params.channel)
    .eq("target_jid", params.targetJid).is("revoked_at", null).maybeSingle();
  if (result.error) throw new Error("destination_read_failed");
  return Boolean(result.data);
}

/**
 * Sends one tester message. A timeout or an unclear receipt is reported as
 * inconclusive — never as a failure that would justify sending again.
 */
export async function dispatchLabText(params: {
  tenantId: string; connectionId: string; channel: string; targetJid: string; text: string;
}): Promise<LabDispatch> {
  const sender = await getLabSender();
  if (!sender || sender.state !== "open") return { outcome: "rejected", code: "sender_not_connected" };
  if (!sender.instance_name.startsWith(LAB_INSTANCE_PREFIX)) return { outcome: "rejected", code: "sender_identity_invalid" };

  const target = labPhoneJid(params.targetJid);
  if (!target) return { outcome: "rejected", code: "target_jid_invalid" };
  if (labPhoneJid(sender.wa_jid) === target) return { outcome: "rejected", code: "same_number_rejected" };
  if (!(await assertLabDestinationAuthorized({ ...params, targetJid: target }))) {
    return { outcome: "rejected", code: "destination_not_authorized" };
  }

  let result: Awaited<ReturnType<typeof evolutionSendText>>;
  try {
    result = await evolutionSendText({
      instanceName: sender.instance_name,
      number: jidToDigits(target),
      text: params.text.slice(0, 4000),
      // The laboratory talks only to numbers already confirmed in the catalogue.
      resolveRecipient: false,
    });
  } catch {
    return { outcome: "inconclusive", code: "send_transport_unknown", providerMessageId: null };
  }
  if (!result.ok) {
    // A refusal the provider states explicitly is a rejection; anything else is unknown.
    const stated = result.status >= 400 && result.status < 500;
    return stated
      ? { outcome: "rejected", code: `send_refused_${result.status}` }
      : { outcome: "inconclusive", code: "send_status_unknown", providerMessageId: null };
  }

  const receipt = extractEvolutionSendReceipt(result.data);
  if (!receipt.messageId) return { outcome: "inconclusive", code: "receipt_missing", providerMessageId: null };

  const status = await evolutionWaitForMessageStatus({
    instanceName: sender.instance_name, messageId: receipt.messageId, attempts: 3, intervalMs: 1200,
  }).catch(() => ({ status: null, update: null }));

  return { outcome: "confirmed", providerMessageId: receipt.messageId, deliveryStatus: status.status ?? receipt.deliveryStatus ?? null };
}
