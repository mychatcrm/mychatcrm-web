import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { evolutionSendText, evolutionSendMedia, evolutionSendAudio, evolutionWaitForMessageStatus, jidToDigits } from "@/lib/integrations/evolution-api";
import { extractEvolutionSendReceipt } from "@/lib/integrations/evolution-message-receipt";
import { LAB_INSTANCE_PREFIX, LAB_OWNER_ID, labPhoneJid } from "@/lib/agent-test-lab/policy";
import { getLabSender } from "./connections";
import { signLabAsset } from "./assets-store";

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
  const sb = createSupabaseServiceClient();
  const result = await sb
    .from("agent_test_lab_destinations").select("id")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("tenant_id", params.tenantId)
    .eq("connection_id", params.connectionId).eq("channel", params.channel)
    .eq("target_jid", params.targetJid).is("revoked_at", null).maybeSingle();
  if (result.error) throw new Error("destination_read_failed");
  if (!result.data) return false;
  // A catalogue entry cannot authorize a different number after a reconnect.
  if (!["evolution", "meta_cloud"].includes(params.channel)) return false;
  const evolution = params.channel === "evolution";
  const connection = await sb.from(evolution ? "tenant_evolution_instances" : "whatsapp_cloud_connections")
    .select(evolution ? "wa_jid,connection_state" : "display_phone,active")
    .eq("tenant_id", params.tenantId).eq("id", params.connectionId).maybeSingle();
  if (connection.error) throw new Error("destination_connection_read_failed");
  const row = connection.data as Record<string, unknown> | null;
  return Boolean(row && labPhoneJid(evolution ? row.wa_jid : row.display_phone) === params.targetJid &&
    (evolution ? row.connection_state === "open" : row.active === true));
}

/**
 * Sends one tester message. A timeout or an unclear receipt is reported as
 * inconclusive — never as a failure that would justify sending again.
 */
export async function dispatchLabText(params: {
  tenantId: string; connectionId: string; channel: string; targetJid: string; text: string;
  authorizeDispatch: () => Promise<boolean>;
}): Promise<LabDispatch> {
  if (!params.text.trim() || params.text.length > 4000) return { outcome: "rejected", code: "message_length_invalid" };
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
  if (!(await params.authorizeDispatch())) return { outcome: "rejected", code: "dispatch_revoked" };
  try {
    result = await evolutionSendText({
      instanceName: sender.instance_name,
      number: jidToDigits(target),
      text: params.text,
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

/**
 * Sends one controlled file from the tester. The provider fetches it through a
 * short-lived signed URL, so the bucket itself is never public. Receiving the file
 * is all this proves — whether the agent read it is settled elsewhere.
 */
export async function dispatchLabMedia(params: {
  tenantId: string; connectionId: string; channel: string; targetJid: string;
  assetId: string; caption?: string; authorizeDispatch: () => Promise<boolean>;
}): Promise<LabDispatch> {
  if ((params.caption?.length ?? 0) > 1000) return { outcome: "rejected", code: "caption_length_invalid" };
  const sender = await getLabSender();
  if (!sender || sender.state !== "open") return { outcome: "rejected", code: "sender_not_connected" };
  if (!sender.instance_name.startsWith(LAB_INSTANCE_PREFIX)) return { outcome: "rejected", code: "sender_identity_invalid" };
  const target = labPhoneJid(params.targetJid);
  if (!target) return { outcome: "rejected", code: "target_jid_invalid" };
  if (labPhoneJid(sender.wa_jid) === target) return { outcome: "rejected", code: "same_number_rejected" };
  if (!(await assertLabDestinationAuthorized({ ...params, targetJid: target }))) {
    return { outcome: "rejected", code: "destination_not_authorized" };
  }

  let signed: Awaited<ReturnType<typeof signLabAsset>>;
  try { signed = await signLabAsset(params.assetId); }
  catch { return { outcome: "rejected", code: "asset_unavailable" }; }

  let result: Awaited<ReturnType<typeof evolutionSendMedia>>;
  if (!(await params.authorizeDispatch())) return { outcome: "rejected", code: "dispatch_revoked" };
  try {
    result = signed.asset.kind === "audio"
      ? await evolutionSendAudio({ instanceName: sender.instance_name, number: jidToDigits(target), audio: signed.url })
      : await evolutionSendMedia({
          instanceName: sender.instance_name, number: jidToDigits(target),
          mediatype: signed.asset.kind as "image" | "video" | "document",
          mimetype: signed.asset.mimeType, media: signed.url,
          caption: params.caption ?? "", fileName: signed.asset.filename,
        });
  } catch {
    return { outcome: "inconclusive", code: "send_transport_unknown", providerMessageId: null };
  }
  if (!result.ok) {
    const stated = result.status >= 400 && result.status < 500;
    return stated
      ? { outcome: "rejected", code: `send_refused_${result.status}` }
      : { outcome: "inconclusive", code: "send_status_unknown", providerMessageId: null };
  }
  const receipt = extractEvolutionSendReceipt(result.data);
  if (!receipt.messageId) return { outcome: "inconclusive", code: "receipt_missing", providerMessageId: null };
  const status = await evolutionWaitForMessageStatus({
    instanceName: sender.instance_name, messageId: receipt.messageId, attempts: 3, intervalMs: 1500,
  }).catch(() => ({ status: null, update: null }));
  return { outcome: "confirmed", providerMessageId: receipt.messageId, deliveryStatus: status.status ?? receipt.deliveryStatus ?? null };
}
