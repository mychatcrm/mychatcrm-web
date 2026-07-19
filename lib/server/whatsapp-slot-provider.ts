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

export type SlotProviderSwitchResult = {
  /** Regras de lead_distribution_rules que foram repontadas pro novo lado. */
  switchedRuleIds: string[];
  /**
   * Regras de Lead Ads (source=meta_form) que NÃO foram repontadas pra API Meta
   * porque não têm template aprovado configurado — continuam no QR, funcionando,
   * até o template ser definido em Distribuição de Leads.
   */
  blockedRules: { id: string; name: string | null }[];
};

type LeadDistributionRuleCandidate = {
  id: string;
  name: string | null;
  source: string | null;
  meta_template_name: string | null;
};

/**
 * Troca qual dos dois métodos (QR ou API Meta) responde por esta linha — nunca
 * apaga credenciais de nenhum dos lados, só alterna o registro. Repassa
 * connection_id/transport em lead_distribution_rules do lado antigo pro novo,
 * pra roteamento de inbound continuar funcionando sem reconfigurar regras
 * manualmente (resolveDirectJourneyAgent casa por connection_id exato).
 *
 * Migrar pra API Meta é seguro para conversas em andamento (texto livre dentro
 * da janela de 24h), mas o 1º contacto de uma regra de Lead Ads
 * (resolveMetaLeadWhatsappConnection) exige template aprovado — sem ele, cai
 * num fallback silencioso pro QR antigo e o alternador fica sem efeito real
 * pra essa regra. Por isso essas regras só migram se já tiverem um template
 * configurado; as demais permanecem no QR (continuam funcionando) e voltam
 * como `blockedRules` pro chamador avisar o usuário.
 */
export async function setSlotActiveProvider(
  tenantId: string,
  slotIndex: number,
  provider: SlotProvider,
): Promise<SlotProviderSwitchResult> {
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

  const result: SlotProviderSwitchResult = { switchedRuleIds: [], blockedRules: [] };
  if (!fromConnectionId || !toConnectionId) return result;

  const { data: candidateRows } = await sb
    .from("lead_distribution_rules")
    .select("id, name, source, meta_template_name")
    .eq("tenant_id", tenantId)
    .eq("connection_id", fromConnectionId);

  const candidates = (candidateRows ?? []) as LeadDistributionRuleCandidate[];
  const isReady = (rule: LeadDistributionRuleCandidate) =>
    toTransport === "evolution" || rule.source !== "meta_form" || Boolean(rule.meta_template_name?.trim());

  const ready = candidates.filter(isReady);
  const blocked = candidates.filter((rule) => !isReady(rule));

  if (ready.length > 0) {
    await sb
      .from("lead_distribution_rules")
      .update({ connection_id: toConnectionId, transport: toTransport, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("connection_id", fromConnectionId)
      .in(
        "id",
        ready.map((rule) => rule.id),
      );
  }

  result.switchedRuleIds = ready.map((rule) => rule.id);
  result.blockedRules = blocked.map((rule) => ({ id: rule.id, name: rule.name }));
  return result;
}
