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
 * Finalidade travada de uma linha. `null` = livre: a linha aceita qualquer
 * regra, que é o comportamento histórico e o padrão de quem nunca escolheu.
 */
export type SlotPurpose = "forms" | "direct";

function asSlotPurpose(value: unknown): SlotPurpose | null {
  return value === "forms" || value === "direct" ? value : null;
}

export async function getSlotPurpose(tenantId: string, slotIndex: number): Promise<SlotPurpose | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_whatsapp_slot_state")
    .select("purpose")
    .eq("tenant_id", tenantId)
    .eq("slot_index", slotIndex)
    .maybeSingle();
  if (error) {
    // Falha de leitura não pode travar regra nenhuma: sem finalidade conhecida,
    // a linha se comporta como livre (igual a antes desta coluna existir).
    console.warn("[whatsapp-slot-provider] purpose_query_failed", error.code ?? "", error.message);
    return null;
  }
  return asSlotPurpose((data as { purpose?: unknown } | null)?.purpose);
}

/** Finalidade de todas as linhas do tenant numa query só, para as listagens. */
export async function getSlotPurposesForTenant(tenantId: string): Promise<Map<number, SlotPurpose | null>> {
  const purposes = new Map<number, SlotPurpose | null>();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_whatsapp_slot_state")
    .select("slot_index, purpose")
    .eq("tenant_id", tenantId);
  if (error) {
    console.warn("[whatsapp-slot-provider] purposes_query_failed", error.code ?? "", error.message);
    return purposes;
  }
  for (const row of (data ?? []) as Array<{ slot_index?: unknown; purpose?: unknown }>) {
    if (typeof row.slot_index !== "number") continue;
    purposes.set(row.slot_index, asSlotPurpose(row.purpose));
  }
  return purposes;
}

/**
 * Grava a finalidade da linha. Resolve `active_provider` antes do upsert porque
 * a coluna é NOT NULL e a linha pode ainda não ter registro — gravar o padrão
 * resolvido ("evolution") é semanticamente idêntico a não ter registro nenhum.
 */
export async function setSlotPurpose(
  tenantId: string,
  slotIndex: number,
  purpose: SlotPurpose | null,
): Promise<{ error: string | null }> {
  const activeProvider = await getSlotActiveProvider(tenantId, slotIndex);
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("tenant_whatsapp_slot_state").upsert(
    {
      tenant_id: tenantId,
      slot_index: slotIndex,
      active_provider: activeProvider,
      purpose,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,slot_index" },
  );
  return { error: error?.message ?? null };
}

export type AllocateSlotForPurposeResult =
  | { ok: true; slotIndex: number; isNewSlot: boolean }
  | { ok: false; reason: "no_capacity" };

/** Slots com número conectado de verdade (QR aberto ou Cloud ativa), qualquer finalidade. */
async function listConnectedSlotIndices(tenantId: string): Promise<Set<number>> {
  const sb = createSupabaseServiceClient();
  const [evoRes, cloudRes] = await Promise.all([
    sb
      .from("tenant_evolution_instances")
      .select("slot_index, connection_state")
      .eq("tenant_id", tenantId),
    sb
      .from("whatsapp_cloud_connections")
      .select("slot_index")
      .eq("tenant_id", tenantId)
      .eq("active", true),
  ]);
  const connected = new Set<number>();
  for (const row of (evoRes.data ?? []) as Array<{ slot_index: number; connection_state: string | null }>) {
    if (row.connection_state === "open") connected.add(row.slot_index);
  }
  for (const row of (cloudRes.data ?? []) as Array<{ slot_index: number }>) {
    connected.add(row.slot_index);
  }
  return connected;
}

/**
 * Escolhe (ou reusa) a linha desta finalidade, pra quem conecta clicando numa
 * seção ("Formulários Meta" / "WhatsApp Direto") em vez de escolher um número
 * de linha à mão.
 *
 * - Já existe linha com essa finalidade → reusa a de menor índice (caso comum:
 *   1 número por seção).
 * - Senão, pega a menor linha dentro da capacidade do plano que não tem
 *   finalidade divergente **nem** número conectado — uma linha "livre" mas já
 *   conectada (o caso raro de migração) não é reaproveitada em silêncio; ela
 *   fica pra resolução manual, fora deste caminho.
 * - Sem linha livre dentro da capacidade → `no_capacity` (o chamador oferece
 *   comprar mais uma linha).
 */
export async function resolveOrAllocateSlotForPurpose(params: {
  tenantId: string;
  purpose: SlotPurpose;
  totalSlots: number;
}): Promise<AllocateSlotForPurposeResult> {
  const purposes = await getSlotPurposesForTenant(params.tenantId);

  const existing = [...purposes.entries()]
    .filter(([, purpose]) => purpose === params.purpose)
    .map(([slotIndex]) => slotIndex)
    .sort((a, b) => a - b)[0];
  if (existing !== undefined) return { ok: true, slotIndex: existing, isNewSlot: false };

  const connectedSlots = await listConnectedSlotIndices(params.tenantId);
  for (let slotIndex = 0; slotIndex < params.totalSlots; slotIndex += 1) {
    const currentPurpose = purposes.get(slotIndex) ?? null;
    if (currentPurpose && currentPurpose !== params.purpose) continue;
    if (connectedSlots.has(slotIndex)) continue;

    const { error } = await setSlotPurpose(params.tenantId, slotIndex, params.purpose);
    if (error) {
      console.warn("[whatsapp-slot-provider] allocate_purpose_failed", params.tenantId, slotIndex, error);
      continue;
    }
    return { ok: true, slotIndex, isNewSlot: true };
  }
  return { ok: false, reason: "no_capacity" };
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

  // `purpose` fica de fora do payload de propósito: o upsert só grava as chaves
  // presentes, então a finalidade travada da linha sobrevive à troca QR↔API Meta.
  // Alternar provedor nunca cruza fronteira de finalidade — as duas pontas são
  // da mesma linha —, então não há o que revalidar aqui.
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
