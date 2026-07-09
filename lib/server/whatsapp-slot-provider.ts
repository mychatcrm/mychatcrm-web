import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getEvolutionInstanceByTenantSlot } from "@/lib/server/tenant-evolution-instance-db";
import { getWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";

export type SlotProvider = "evolution" | "cloud_api";

/**
 * Provedor ativo de uma linha (tenant+slot) — espelha isMetaProviderActive/
 * setSystemActiveProvider de system-agent.ts, agora genérico por tenant+linha.
 * Sem registro = "evolution" (comportamento histórico antes do alternador existir).
 */
export async function getSlotActiveProvider(tenantId: string, slotIndex: number): Promise<SlotProvider> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("tenant_whatsapp_slot_state")
    .select("active_provider")
    .eq("tenant_id", tenantId)
    .eq("slot_index", slotIndex)
    .maybeSingle();
  return (data?.active_provider as SlotProvider | undefined) ?? "evolution";
}

/**
 * Troca qual dos dois métodos (QR ou API Meta) responde por esta linha — nunca
 * apaga credenciais de nenhum dos lados, só alterna o registro. Repassa
 * connection_id/transport em lead_distribution_rules do lado antigo pro novo,
 * pra roteamento de inbound continuar funcionando sem reconfigurar regras
 * manualmente (resolveDirectJourneyAgent casa por connection_id exato).
 */
export async function setSlotActiveProvider(tenantId: string, slotIndex: number, provider: SlotProvider): Promise<void> {
  const sb = createSupabaseServiceClient();

  const [evoRow, cloudRow] = await Promise.all([
    getEvolutionInstanceByTenantSlot(tenantId, slotIndex),
    getWhatsAppCloudConnection(tenantId, slotIndex),
  ]);
  const evoConnectionId = evoRow?.id ?? null;
  const cloudConnectionId = cloudRow?.phone_number_id ?? null;

  const [fromConnectionId, toConnectionId, toTransport] =
    provider === "cloud_api"
      ? [evoConnectionId, cloudConnectionId, "cloud_api" as const]
      : [cloudConnectionId, evoConnectionId, "evolution" as const];

  await sb.from("tenant_whatsapp_slot_state").upsert(
    {
      tenant_id: tenantId,
      slot_index: slotIndex,
      active_provider: provider,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,slot_index" },
  );

  if (fromConnectionId && toConnectionId) {
    await sb
      .from("lead_distribution_rules")
      .update({ connection_id: toConnectionId, transport: toTransport, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("connection_id", fromConnectionId);
  }
}
