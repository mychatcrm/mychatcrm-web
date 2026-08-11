import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { SlotProvider } from "@/lib/server/whatsapp-slot-provider";

export type TenantWhatsappConnection = {
  /** UUID de tenant_evolution_instances (QR) ou phone_number_id (Meta) — mesmo valor gravado em whatsapp_messages.connection_id. */
  connectionId: string;
  transport: "evolution" | "cloud_api";
  label: string;
  /** Índice da linha (0, 1, 2…). */
  slotIndex: number;
  connected: boolean;
  /** Qual dos dois métodos está respondendo por esta linha hoje (alternador). */
  activeProvider: SlotProvider;
};

function formatJidPhone(jid: string | null): string | null {
  if (!jid) return null;
  const digits = jid.split("@")[0]?.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

/**
 * Lista todas as linhas de WhatsApp (QR Code + API Meta) que o tenant tem
 * hoje — fonte única usada tanto pelo filtro por número em
 * /dashboard/conversas quanto pela tela /dashboard/integracoes.
 */
export async function listTenantWhatsappConnections(tenantId: string): Promise<TenantWhatsappConnection[]> {
  const sb = createSupabaseServiceClient();
  const [evoRes, metaRes, slotStateRes] = await Promise.all([
    sb
      .from("tenant_evolution_instances")
      .select("id, slot_index, wa_jid, connection_state")
      .eq("tenant_id", tenantId)
      .order("slot_index", { ascending: true }),
    sb
      .from("whatsapp_cloud_connections")
      .select("phone_number_id, slot_index, display_phone, active")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("slot_index", { ascending: true }),
    sb
      .from("tenant_whatsapp_slot_state")
      .select("slot_index, active_provider")
      .eq("tenant_id", tenantId),
  ]);

  const evoRows = (evoRes.data ?? []) as { id: string; slot_index: number; wa_jid: string | null; connection_state: string }[];
  const metaRows = (metaRes.data ?? []) as {
    phone_number_id: string;
    slot_index: number;
    display_phone: string | null;
    active: boolean;
  }[];

  const activeProviderBySlot = new Map<number, SlotProvider>();
  for (const row of (slotStateRes.data ?? []) as Array<{ slot_index: number; active_provider: string }>) {
    activeProviderBySlot.set(row.slot_index, row.active_provider === "cloud_api" ? "cloud_api" : "evolution");
  }

  const evoConnections: TenantWhatsappConnection[] = evoRows.map((row) => {
    const phone = formatJidPhone(row.wa_jid);
    return {
      connectionId: row.id,
      transport: "evolution",
      label: phone ? `QR Code · ${phone}` : "QR Code",
      slotIndex: row.slot_index,
      connected: row.connection_state === "open",
      activeProvider: activeProviderBySlot.get(row.slot_index) ?? "evolution",
    };
  });

  const metaConnections: TenantWhatsappConnection[] = metaRows.map((row) => ({
    connectionId: row.phone_number_id,
    transport: "cloud_api",
    label: row.display_phone ? `API Meta · ${row.display_phone}` : "API Meta",
    slotIndex: row.slot_index,
    connected: row.active,
    activeProvider: activeProviderBySlot.get(row.slot_index) ?? "evolution",
  }));

  return [...evoConnections, ...metaConnections];
}
