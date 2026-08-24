import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  agentCrmDestinationDbFields,
  assembleStoredSystemPrompt,
  normalizeAgentCrmDestination,
  sanitizeAgentResponseSettings,
  validateAgentCrmDestination,
  validateAgentResponseSettings,
} from "@/lib/agents";
import {
  AGENT_SELECT_WITH_CRM,
  BASE_AGENT_SELECT,
  isMissingColumnError,
  rowToAgent,
} from "@/lib/server/tenant-agents-db";
import { describeAgentActivationBlock } from "@/lib/server/agent-plan-limit";
import {
  DISPAROS_DEFAULT_AGENT_ID,
  isBroadcastAgentMetadata,
} from "@/lib/server/broadcast-agent-identity";
import type { Agent } from "@/lib/types";
import {
  validateAgentExternalApiConnectorIds,
} from "@/lib/server/external-api-connectors";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";
import {
  describeAgentContextFailure,
  isAgentArchivedMetadata,
  resolveAgentContextSaveDecision,
  validateAgentManagementPayload,
} from "@/lib/server/agent-management-validation";
import { saveTenantAgentAtomic } from "@/lib/server/agent-management-persistence";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET — lista agentes do tenant
// ---------------------------------------------------------------------------

export async function GET() {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session, canManageExternalApis } = guard.value;

  const sb = createSupabaseServiceClient();
  const initial = await sb
    .from("tenant_agents")
    .select(AGENT_SELECT_WITH_CRM)
    .eq("tenant_id", session.tenantId)
    .order("updated_at", { ascending: false });
  let data: unknown[] | null = initial.data;
  let error = initial.error;

  if (isMissingColumnError(error)) {
    const fallback = await sb
      .from("tenant_agents")
      .select(BASE_AGENT_SELECT)
      .eq("tenant_id", session.tenantId)
      .order("updated_at", { ascending: false });
    data = fallback.data as unknown[] | null;
    error = fallback.error;
  }

  if (error) {
    console.error("[api/client/agentes] GET", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar agentes." }, { status: 503 });
  }

  const visibleRows = (data ?? []).filter((row) => {
    const record = row as Record<string, unknown>;
    return !record.archived_at && !isAgentArchivedMetadata(record.metadata);
  });
  const agents: Agent[] = visibleRows.map((row) => rowToAgent(row as Record<string, unknown>, session.tenantId));
  if (canManageExternalApis && agents.length) {
    const { data: links } = await sb.from("agent_external_api_connectors").select("agent_id,connector_id").eq("tenant_id", session.tenantId);
    const byAgent = new Map<string, string[]>();
    for (const link of links ?? []) byAgent.set(String(link.agent_id), [...(byAgent.get(String(link.agent_id)) ?? []), String(link.connector_id)]);
    for (const agent of agents) agent.externalApiConnectorIds = byAgent.get(agent.id) ?? [];
  } else for (const agent of agents) delete agent.externalApiConnectorIds;

  return NextResponse.json({ agents }, { headers: { "Cache-Control": "no-store" } });
}

// ---------------------------------------------------------------------------
// POST — cria novo agente para o tenant
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session, canManageExternalApis } = guard.value;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const validation = validateAgentManagementPayload(payload, { requireId: true });
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const agent = validation.agent;
  const responseSettingsError = validateAgentResponseSettings(agent);
  if (responseSettingsError) {
    return NextResponse.json({ error: responseSettingsError }, { status: 400 });
  }
  const crmDestinationError = validateAgentCrmDestination(agent);
  if (crmDestinationError) {
    return NextResponse.json({ error: crmDestinationError }, { status: 400 });
  }
  const contextDecision = resolveAgentContextSaveDecision({ agent });
  if (contextDecision.blocked && !contextDecision.validation.ok) {
    return NextResponse.json(
      describeAgentContextFailure(contextDecision.validation),
      { status: 422 },
    );
  }

  const sb = createSupabaseServiceClient();
  const existing = await sb
    .from("tenant_agents")
    .select("agent_id")
    .eq("tenant_id", session.tenantId)
    .eq("agent_id", agent.id)
    .maybeSingle();
  if (existing.error) {
    console.error("[api/client/agentes] POST lookup", existing.error.code, existing.error.message);
    return NextResponse.json({ error: "Erro ao validar o novo agente." }, { status: 503 });
  }
  if (existing.data) {
    return NextResponse.json(
      { error: "Já existe um agente com este ID.", code: "AGENT_ID_CONFLICT" },
      { status: 409 },
    );
  }
  // Cota de agente de Disparos é separada da de atendimento — quem decide é o
  // próprio payload que está sendo salvo, não o estado antigo no banco.
  const isBroadcastAgent = agent.id === DISPAROS_DEFAULT_AGENT_ID || isBroadcastAgentMetadata(agent);
  const activationBlock = await describeAgentActivationBlock({
    sb,
    session,
    agentId: agent.id,
    willBeActive: agent.status === "ativo",
    isBroadcastAgent,
  });
  if (activationBlock) {
    return NextResponse.json({ error: activationBlock }, { status: 403 });
  }

  const systemPrompt = assembleStoredSystemPrompt(agent);
  const responseSettings = sanitizeAgentResponseSettings(agent);
  const normalizedCrmDestination = normalizeAgentCrmDestination(agent);
  const crmDestination = agentCrmDestinationDbFields(agent);
  let requestedConnectorIds = canManageExternalApis && Array.isArray(agent.externalApiConnectorIds) ? agent.externalApiConnectorIds : [];
  if (canManageExternalApis) {
    try {
      requestedConnectorIds = await validateAgentExternalApiConnectorIds(session.tenantId, requestedConnectorIds);
    } catch (connectorError) {
      const unavailable = connectorError instanceof Error && connectorError.message === "external_api_connector_not_available";
      return NextResponse.json(
        { error: unavailable ? "Uma das APIs externas selecionadas não está disponível." : "Não foi possível validar as APIs externas agora." },
        { status: unavailable ? 400 : 503 },
      );
    }
  }
  const metadataAgent = { ...agent }; delete metadataAgent.externalApiConnectorIds;

  let saved: Awaited<ReturnType<typeof saveTenantAgentAtomic>>;
  try {
    saved = await saveTenantAgentAtomic(sb, {
      tenantId: session.tenantId,
      agentId: agent.id,
      createOnly: true,
      expectedVersion: null,
      displayName: agent.nome.trim(),
      systemPrompt: systemPrompt || agent.systemPrompt || "",
      active: agent.status === "ativo",
      metadata: { ...metadataAgent, ...responseSettings, ...normalizedCrmDestination },
      voiceId: responseSettings.voiceId,
      responseMode: responseSettings.responseMode,
      crmAutoMoveEnabled: crmDestination.crm_auto_move_enabled === true,
      crmTargetFunnelId: typeof crmDestination.crm_target_funnel_id === "string" ? crmDestination.crm_target_funnel_id : null,
      crmTargetColumnId: typeof crmDestination.crm_target_column_id === "string" ? crmDestination.crm_target_column_id : null,
      crmTargetStatus: typeof crmDestination.crm_target_status === "string" ? crmDestination.crm_target_status : null,
      reviewStatus: contextDecision.reviewStatus,
      reviewReasons: contextDecision.reviewReasons,
      replaceConnectors: canManageExternalApis,
      connectorIds: requestedConnectorIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent_save_failed";
    if (message.includes("agent_already_exists")) {
      return NextResponse.json({ error: "Já existe um agente com este ID.", code: "AGENT_ID_CONFLICT" }, { status: 409 });
    }
    console.error("[api/client/agentes] POST atomic", { error: message });
    return NextResponse.json({ error: "Erro ao criar agente." }, { status: 503 });
  }
  if (!saved.ok || !saved.row) {
    return NextResponse.json(
      { error: "A configuração do agente foi bloqueada.", code: saved.ok ? "AGENT_SAVE_BLOCKED" : saved.code },
      { status: 409 },
    );
  }
  const created = rowToAgent(saved.row, session.tenantId);
  if (canManageExternalApis) created.externalApiConnectorIds = requestedConnectorIds;
  return NextResponse.json({ agent: created }, { status: 201 });
}
