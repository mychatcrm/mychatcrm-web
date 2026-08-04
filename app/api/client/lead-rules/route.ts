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
  syncMetaFormCaptureBoundariesForRule,
} from "@/lib/server/lead-rules-meta-sync";
import { stringArray } from "@/lib/server/meta-form-authorization";
import { validateMetaAutomationConnection } from "@/lib/server/lead-rules-connection-validation";
import {
  classifyRuleAgentIssues,
  loadTenantAgentActivation,
} from "@/lib/server/lead-rule-agent-health";

export const dynamic = "force-dynamic";

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
      console.warn("[lead-rules] Failed to sync organic_agent_id", error.message);
    }
    return;
  }

  console.warn("[lead-rules] organic agent sync skipped without explicit connection", {
    tenant_id: tenantId,
    agent_id: firstAgentId,
  });
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

  // Regra apontando para agente apagado ou pausado não atende ninguém, e o
  // bloqueio acontece só na hora do lead. O painel precisa avisar antes.
  const activation = await loadTenantAgentActivation(sb, session.tenantId);
  const rules = (data ?? []).map((row) => {
    const rule = leadRuleRowToClient(row);
    if (!activation) return rule;
    const agentIssues = classifyRuleAgentIssues(rule.agentIds, activation);
    return agentIssues.length ? { ...rule, agentIssues } : rule;
  });

  return NextResponse.json({ rules });
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

  const organicValidationError = validateOrganicRulePayload(payload);
  if (organicValidationError) return organicValidationError;
  const metaConnectionValidationError = await validateMetaAutomationConnection(sb, session.tenantId, payload);
  if (metaConnectionValidationError) return metaConnectionValidationError;

  // Uma conexão pode autorizar somente um agente direto, mas o tenant pode ter
  // várias conexões e uma regra independente para cada uma.
  if (payload.source === "whatsapp_organico") {
    const connectionId = String(payload.connection_id);
    const transport = String(payload.transport ?? "evolution");
    const { count: organicCount } = await sb
      .from("lead_distribution_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("source", "whatsapp_organico")
      .eq("transport", transport)
      .eq("connection_id", connectionId);

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
    await syncMetaFormCaptureBoundariesForRule(sb, data);
    await syncMetaFormAgentMappingForRule(sb, data);
    await reconcileMetaFormMappingsWithRules(sb, session.tenantId);
    metaWebhookSubscription = await ensureMetaLeadWebhookSubscriptionForRule(sb, data);
  }

  // Keep organic_agent_id in sync for organic WhatsApp rules
  if (data.source === "whatsapp_organico") {
    await syncOrganicAgentId(
      sb,
      session.tenantId,
      data.agent_ids,
      data.connection_id,
      data.transport,
    );
  }

  return NextResponse.json({ rule: leadRuleRowToClient(data), metaWebhookSubscription }, { status: 201 });
}
