import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  leadRuleClientToDbPayload,
  leadRuleRowToClient,
  type LeadDistributionRuleRow,
} from "@/lib/server/lead-distribution-rules";
import { stringArray } from "@/lib/server/meta-form-authorization";
import {
  deleteMetaFormMappingsForRule,
  reconcileMetaFormMappingsWithRules,
  syncMetaFormAgentMappingForRule,
} from "@/lib/server/lead-rules-meta-sync";

export const dynamic = "force-dynamic";

const META_AUTOMATION_DISTRIBUTION_TYPES = new Set(["automation_agent", "specific_agents", "round_robin"]);
const ORGANIC_AGENT_DISTRIBUTION_TYPES = new Set(["automation_agent", "specific_agents", "round_robin"]);

/** @see app/api/client/lead-rules/route.ts — same logic, kept in sync */
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

  const { error } = await sb
    .from("tenant_evolution_instances")
    .update({ organic_agent_id: firstAgentId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("slot_index", slotIndex);

  if (error) {
    console.warn("[lead-rules/[id]] Failed to sync organic_agent_id", error.message);
  }
}

async function clearOrganicAgentId(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  agentIds: unknown,
): Promise<void> {
  const ids = stringArray(agentIds);
  let query = sb
    .from("tenant_evolution_instances")
    .update({ organic_agent_id: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);

  if (ids.length > 0) {
    query = query.in("organic_agent_id", ids);
  }

  const { error } = await query;
  if (error) {
    console.warn("[lead-rules/[id]] Failed to clear organic_agent_id", error.message);
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

type RouteContext = {
  params: { id: string };
};

export async function PUT(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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
  const { data: existing, error: existingError } = await sb
    .from("lead_distribution_rules")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .maybeSingle<LeadDistributionRuleRow>();

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  let payload: Record<string, unknown>;
  try {
    payload = leadRuleClientToDbPayload(body, session.tenantId, existing.order_index ?? 999);
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

  // Block editing to whatsapp_organico if another rule of this type already exists
  if (payload.source === "whatsapp_organico") {
    const { count: organicCount } = await sb
      .from("lead_distribution_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("source", "whatsapp_organico")
      .neq("id", params.id); // exclude the rule being edited

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

  delete payload.tenant_id;

  const { data, error } = await sb
    .from("lead_distribution_rules")
    .update(payload)
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .select("*")
    .single<LeadDistributionRuleRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data.source === "meta_form") {
    if (stringArray(data.agent_ids).length === 0) {
      await deleteMetaFormMappingsForRule(sb, data);
      await reconcileMetaFormMappingsWithRules(sb, session.tenantId);
    } else {
      await syncMetaFormAgentMappingForRule(sb, data);
      await reconcileMetaFormMappingsWithRules(sb, session.tenantId);
    }
  }

  if (existing.source === "whatsapp_organico" && data.source !== "whatsapp_organico") {
    await clearOrganicAgentId(sb, session.tenantId, existing.agent_ids);
  }

  // Keep organic_agent_id in sync for organic WhatsApp rules
  if (data.source === "whatsapp_organico") {
    if (existing.source === "whatsapp_organico") {
      const previousIds = stringArray(existing.agent_ids);
      const nextIds = stringArray(data.agent_ids);
      const staleIds = previousIds.filter((id) => !nextIds.includes(id));
      if (staleIds.length > 0) {
        await clearOrganicAgentId(sb, session.tenantId, staleIds);
      }
    }
    await syncOrganicAgentId(sb, session.tenantId, data.agent_ids);
  }

  return NextResponse.json({ rule: leadRuleRowToClient(data) });
}

export async function DELETE(_req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();
  const { data: existing, error: existingError } = await sb
    .from("lead_distribution_rules")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .maybeSingle<LeadDistributionRuleRow>();

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  if (existing.source === "meta_form") {
    await deleteMetaFormMappingsForRule(sb, existing);
  }
  if (existing.source === "whatsapp_organico") {
    await clearOrganicAgentId(sb, session.tenantId, existing.agent_ids);
  }

  const ruleId = params.id;
  const { error: clearRuleIdError } = await sb
    .from("leads")
    .update({ rule_id: null })
    .eq("tenant_id", session.tenantId)
    .eq("rule_id", ruleId);
  if (clearRuleIdError) {
    return NextResponse.json({ error: clearRuleIdError.message }, { status: 500 });
  }

  const { error: clearCampaignRuleError } = await sb
    .from("leads")
    .update({ campaign_rule_id: null, campaign_active: false })
    .eq("tenant_id", session.tenantId)
    .eq("campaign_rule_id", ruleId);
  if (clearCampaignRuleError) {
    return NextResponse.json({ error: clearCampaignRuleError.message }, { status: 500 });
  }

  const { error } = await sb
    .from("lead_distribution_rules")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", ruleId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing.source === "meta_form") {
    await reconcileMetaFormMappingsWithRules(sb, session.tenantId);
  }

  return NextResponse.json({ success: true });
}
