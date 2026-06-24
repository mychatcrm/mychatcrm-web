import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  leadRuleClientToDbPayload,
  leadRuleRowToClient,
  type LeadDistributionRuleRow,
} from "@/lib/server/lead-distribution-rules";
import {
  ensureMetaLeadWebhookSubscriptionForRule,
  reconcileMetaFormMappingsWithRules,
  syncMetaFormAgentMappingForRule,
} from "@/lib/server/lead-rules-meta-sync";
import { stringArray } from "@/lib/server/meta-form-authorization";

export const dynamic = "force-dynamic";

const META_AUTOMATION_DISTRIBUTION_TYPES = new Set(["automation_agent", "specific_agents", "round_robin"]);
const ORGANIC_AGENT_DISTRIBUTION_TYPES = new Set(["automation_agent", "specific_agents", "round_robin"]);

/**
 * When a whatsapp_organico rule is saved, keep tenant_evolution_instances.organic_agent_id
 * in sync with the rule's first agent. Only called for organic rules — meta_form rules
 * use syncMetaFormAgentMappingForRule instead.
 */
async function syncOrganicAgentId(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  agentIds: unknown,
): Promise<void> {
  const ids = Array.isArray(agentIds)
    ? (agentIds as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const firstAgentId = ids[0];
  if (!firstAgentId) return;

  // Look up the agent's WhatsApp slot index from its metadata
  const { data: agentRow } = await sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .eq("agent_id", firstAgentId)
    .maybeSingle();

  const meta = agentRow?.metadata as Record<string, unknown> | null;
  const rawSlot = meta?.whatsappSlotIndex;
  const slotIndex =
    typeof rawSlot === "number" && Number.isFinite(rawSlot) ? Math.max(0, Math.floor(rawSlot)) : 0;

  // Always overwrite organic_agent_id — the organic rule is the authoritative source
  const { error } = await sb
    .from("tenant_evolution_instances")
    .update({ organic_agent_id: firstAgentId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("slot_index", slotIndex);

  if (error) {
    console.warn("[lead-rules] Failed to sync organic_agent_id", error.message);
  }
}

function validateOrganicRulePayload(payload: Record<string, unknown>): NextResponse | null {
  if (payload.source !== "whatsapp_organico") return null;
  const agentIds = stringArray(payload.agent_ids);
  if (!ORGANIC_AGENT_DISTRIBUTION_TYPES.has(String(payload.distribution_type)) || agentIds.length !== 1) {
    return NextResponse.json(
      { error: "Selecione exatamente um agente de IA ativo para atendimento direto no WhatsApp." },
      { status: 400 },
    );
  }
  return null;
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("lead_distribution_rules")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .order("order_index", { ascending: true })
    .returns<LeadDistributionRuleRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rules: (data ?? []).map(leadRuleRowToClient) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { count } = await sb
    .from("lead_distribution_rules")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId);

  let payload: Record<string, unknown>;
  try {
    payload = leadRuleClientToDbPayload(body, session.tenantId, count ?? 999);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid payload" }, { status: 400 });
  }

  if (
    payload.source === "meta_form" &&
    typeof payload.distribution_type === "string" &&
    META_AUTOMATION_DISTRIBUTION_TYPES.has(payload.distribution_type) &&
    stringArray(payload.agent_ids).length === 0
  ) {
    return NextResponse.json({ error: "Selecione um agente de IA ativo para esta regra." }, { status: 400 });
  }

  const organicValidationError = validateOrganicRulePayload(payload);
  if (organicValidationError) return organicValidationError;

  // Block creation of a second whatsapp_organico rule — only one organic agent per tenant
  if (payload.source === "whatsapp_organico") {
    const { count: organicCount } = await sb
      .from("lead_distribution_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("source", "whatsapp_organico");

    if ((organicCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Já existe um agente orgânico configurado para este número. Apenas um agente pode atender contatos diretos por número.",
        },
        { status: 409 },
      );
    }
  }

  const { data, error } = await sb
    .from("lead_distribution_rules")
    .insert(payload)
    .select("*")
    .single<LeadDistributionRuleRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let metaWebhookSubscription = null;
  if (data.source === "meta_form") {
    await syncMetaFormAgentMappingForRule(sb, data);
    await reconcileMetaFormMappingsWithRules(sb, session.tenantId);
    metaWebhookSubscription = await ensureMetaLeadWebhookSubscriptionForRule(sb, data);
  }

  // Keep organic_agent_id in sync for organic WhatsApp rules
  if (data.source === "whatsapp_organico") {
    await syncOrganicAgentId(sb, session.tenantId, data.agent_ids);
  }

  return NextResponse.json({ rule: leadRuleRowToClient(data), metaWebhookSubscription }, { status: 201 });
}
