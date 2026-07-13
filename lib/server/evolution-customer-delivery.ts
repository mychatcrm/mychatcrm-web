import {
  extractEvolutionSendReceipt,
  mapEvolutionDeliveryStatus,
  normalizeEvolutionProviderStatus,
  shouldApplyCustomerDeliveryStatus,
  type CustomerDeliveryStatus,
  type EvolutionSendReceipt,
} from "@/lib/integrations/evolution-message-receipt";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function deliveryTimestamps(status: CustomerDeliveryStatus, now: string): Record<string, string> {
  if (status === "read") return { sent_at: now, delivered_at: now, read_at: now };
  if (status === "delivered") return { sent_at: now, delivered_at: now };
  if (status === "sent") return { sent_at: now };
  return {};
}

export async function persistEvolutionSendReceipt(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  messageRowId: string;
  connectionId?: string | null;
  payload: unknown;
}): Promise<EvolutionSendReceipt> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const receipt = extractEvolutionSendReceipt(params.payload);
  const now = new Date().toISOString();
  const missingReceipt = !receipt.messageId;
  const update: Record<string, unknown> = {
    delivery_status: receipt.deliveryStatus,
    provider_message_id: receipt.messageId,
    provider_remote_jid: receipt.remoteJid,
    provider_status: receipt.providerStatus,
    failed_reason:
      receipt.deliveryStatus === "failed"
        ? "evolution_delivery_error"
        : missingReceipt
          ? "evolution_receipt_missing_message_id"
          : null,
    ...deliveryTimestamps(receipt.deliveryStatus, now),
  };
  if (params.connectionId) update.connection_id = params.connectionId;

  const { error } = await sb
    .from("whatsapp_messages")
    .update(update)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.messageRowId);
  if (error) {
    console.error("[evolution-customer-delivery] persist_send_receipt_failed", {
      tenant_id: params.tenantId,
      message_row_id: params.messageRowId,
      error: error.message,
    });
  }
  return receipt;
}

export async function processCustomerMessageDeliveryUpdate(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  connectionId?: string | null;
  providerMessageId: string;
  status: unknown;
}): Promise<"updated" | "ignored" | "not_found"> {
  const sb = params.sb ?? createSupabaseServiceClient();
  let query = sb
    .from("whatsapp_messages")
    .select("id, delivery_status")
    .eq("tenant_id", params.tenantId)
    .eq("provider_message_id", params.providerMessageId);
  if (params.connectionId) query = query.eq("connection_id", params.connectionId);
  let { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!data && !error && params.connectionId) {
    const withoutConnection = await sb
      .from("whatsapp_messages")
      .select("id, delivery_status")
      .eq("tenant_id", params.tenantId)
      .eq("provider_message_id", params.providerMessageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    data = withoutConnection.data;
    error = withoutConnection.error;
  }

  // Compatibility for messages recorded before provider_message_id existed.
  if (!data && !error) {
    const fallback = await sb
      .from("whatsapp_messages")
      .select("id, delivery_status")
      .eq("tenant_id", params.tenantId)
      .eq("message_id", params.providerMessageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }
  if (error || !data?.id) return "not_found";

  const deliveryStatus = mapEvolutionDeliveryStatus(params.status);
  if (!shouldApplyCustomerDeliveryStatus(data.delivery_status, deliveryStatus)) return "ignored";

  const now = new Date().toISOString();
  const update = {
    delivery_status: deliveryStatus,
    provider_message_id: params.providerMessageId,
    provider_status: normalizeEvolutionProviderStatus(params.status),
    failed_reason: deliveryStatus === "failed" ? "evolution_delivery_error" : null,
    ...deliveryTimestamps(deliveryStatus, now),
  };
  const { error: updateError } = await sb
    .from("whatsapp_messages")
    .update(update)
    .eq("tenant_id", params.tenantId)
    .eq("id", data.id);
  return updateError ? "not_found" : "updated";
}
