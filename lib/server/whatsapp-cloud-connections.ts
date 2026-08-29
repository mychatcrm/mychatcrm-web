import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type WhatsAppCloudConnection = {
  id: string;
  tenant_id: string;
  slot_index: number;
  phone_number_id: string;
  waba_id: string | null;
  access_token: string;
  display_phone: string | null;
  verified_name: string | null;
  active: boolean;
  connected_at: string;
  updated_at: string;
};

export async function getWhatsAppCloudConnection(
  tenantId: string,
  slotIndex: number,
): Promise<WhatsAppCloudConnection | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("whatsapp_cloud_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("slot_index", slotIndex)
    .eq("active", true)
    .maybeSingle();
  return (data as WhatsAppCloudConnection | null) ?? null;
}

export async function upsertWhatsAppCloudConnection(params: {
  tenantId: string;
  slotIndex: number;
  phoneNumberId: string;
  wabaId: string | null;
  accessToken: string;
  displayPhone: string | null;
  verifiedName: string | null;
}): Promise<{ error: string | null }> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("whatsapp_cloud_connections").upsert(
    {
      tenant_id: params.tenantId,
      slot_index: params.slotIndex,
      phone_number_id: params.phoneNumberId,
      waba_id: params.wabaId,
      access_token: params.accessToken,
      display_phone: params.displayPhone,
      verified_name: params.verifiedName,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,slot_index" },
  );
  return { error: error?.message ?? null };
}

export async function deleteWhatsAppCloudConnection(tenantId: string, slotIndex: number): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from("whatsapp_cloud_connections").delete().eq("tenant_id", tenantId).eq("slot_index", slotIndex);
}

export async function lookupWhatsAppCloudConnectionByPhoneNumberId(
  phoneNumberId: string,
): Promise<WhatsAppCloudConnection | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("whatsapp_cloud_connections")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .eq("active", true)
    .maybeSingle();
  return (data as WhatsAppCloudConnection | null) ?? null;
}

/** Exact tenant-scoped lookup for durable jobs that persist the connection row id. */
export async function getWhatsAppCloudConnectionByIdForTenant(
  tenantId: string,
  connectionId: string,
): Promise<WhatsAppCloudConnection | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("whatsapp_cloud_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", connectionId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`[whatsapp-cloud-connections] exact lookup: ${error.message}`);
  return (data as WhatsAppCloudConnection | null) ?? null;
}
