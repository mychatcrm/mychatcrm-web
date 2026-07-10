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
  ensureMetaLeadWebhookSubscriptionForRule,
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
  connectionId: unknown,
  transport: unknown,
): Promise<void> {
  if (transport === "cloud_api") return;
  const ids = Array.isArray(agentIds)
    ? (agentIds as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const firstAgentId = ids[0];
  if (!firstAgentId) return;

  const explicitConnectionId =
    typeof connectionId === "string" ? connectionId.trim() : "";
  if (explicitConnectionId) {
    const { error } = await sb
      .from("tenant_evolution_instances")
      .update({ organic_agent_id: firstAgentId, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", explicitConnectionId);
    if (error) {
      console.warn("[lead-rules/[id]] Failed to sync organic_agent_id", error.message);
    }
    return;
  }

  console.warn("[lead-rules/[id]] organic agent sync skipped without explicit connection", {
    tenant_id: tenantId,
    agent_id: firstAgentId,
  });
}

async function clearOrganicAgentId(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  agentIds: unknown,
  connectionId?: unknown,
  transport?: unknown,
): Promise<void> {
  if (transport === "cloud_api") return;
  const ids = stringArray(agentIds);
  let query = sb
    .from("tenant_evolution_instances")
    .update({ organic_agent_id: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);

  const explicitConnectionId =
    typeof connectionId === "string" ? connectionId.trim() : "";
  if (explicitConnectionId) {
    query = query.eq("id", explicitConnectionId);
  } else if (ids.length > 0) {
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
  if (typeof payload.connection_id !== "string" || !payload.connection_id.trim()) {
    return NextResponse.json(
      {
        error:
          payload.transport === "cloud_api"
            ? "Informe o Phone Number ID da conexão Cloud API."
            : "Selecione o número/conexão Evolution que esta regra autoriza.",
      },
      { status: 400 },
    );
  }
  return null;
}

async function validateMetaAutomationConnection(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<NextResponse | null> {
  if (
    payload.source !== "meta_form" ||
    !META_AUTOMATION_DISTRIBUTION_TYPES.has(String(payload.distribution_type)) ||
    stringArray(payload.agent_ids).length === 0
  ) {
    return null;
  }
  const connectionId = typeof payload.connection_id === "string" ? payload.connection_id.trim() : "";
  if (!connectionId) {
    return NextResponse.json(
      { error: "Selecione a conexão WhatsApp que este formulário pode usar para o primeiro atendimento." },
      { status: 400 },
    );
  }
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: "A conexão WhatsApp escolhida não pertence a esta conta." }, { status: 400 });
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
  const metaConnectionValidationError = await validateMetaAutomationConnection(sb, session.tenantId, payload);
  if (metaConnectionValidationError) return metaConnectionValidationError;

  // Impede conflito apenas na mesma conexão; números diferentes podem ter
  // agentes diretos independentes dentro do mesmo tenant.
  if (payload.source === "whatsapp_organico") {
    const connectionId = String(payload.connection_id);
    const transport = String(payload.transport ?? "evolution");
    const { count: organicCount } = await sb
      .from("lead_distribution_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("source", "whatsapp_organico")
      .eq("transport", transport)
      .eq("connection_id", connectionId)
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

  let metaWebhookSubscription = null;
  if (data.source === "meta_form") {
    if (stringArray(data.agent_ids).length === 0) {
      await deleteMetaFormMappingsForRule(sb, data);
      await reconcileMetaFormMappingsWithRules(sb, session.tenantId);
    } else {
      await syncMetaFormAgentMappingForRule(sb, data);
      await reconcileMetaFormMappingsWithRules(sb, session.tenantId);
    }
    metaWebhookSubscription = await ensureMetaLeadWebhookSubscriptionForRule(sb, data);
  }

  if (existing.source === "whatsapp_organico" && data.source !== "whatsapp_organico") {
    await clearOrganicAgentId(
      sb,
      session.tenantId,
      existing.agent_ids,
      existing.connection_id,
      existing.transport,
    );
  }

  // Keep organic_agent_id in sync for organic WhatsApp rules
  if (data.source === "whatsapp_organico") {
    if (existing.source === "whatsapp_organico") {
      const previousIds = stringArray(existing.agent_ids);
      const nextIds = stringArray(data.agent_ids);
      const staleIds = previousIds.filter((id) => !nextIds.includes(id));
      const connectionChanged =
        existing.connection_id !== data.connection_id || existing.transport !== data.transport;
      if (staleIds.length > 0 || connectionChanged) {
        await clearOrganicAgentId(
          sb,
          session.tenantId,
          staleIds.length > 0 ? staleIds : existing.agent_ids,
          existing.connection_id,
          existing.transport,
        );
      }
    }
    await syncOrganicAgentId(
      sb,
      session.tenantId,
      data.agent_ids,
      data.connection_id,
      data.transport,
    );
  }

  return NextResponse.json({ rule: leadRuleRowToClient(data), metaWebhookSubscription });
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
    await clearOrganicAgentId(
      sb,
      session.tenantId,
      existing.agent_ids,
      existing.connection_id,
      existing.transport,
    );
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
