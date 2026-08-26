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
import { describeAgentActivationBlock } from "@/lib/server/agent-plan-limit";
import {
  DISPAROS_DEFAULT_AGENT_ID,
  isBroadcastAgentMetadata,
} from "@/lib/server/broadcast-agent-identity";
import {
  listAgentExternalApiConnectorIds,
  validateAgentExternalApiConnectorIds,
} from "@/lib/server/external-api-connectors";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";
import { describeAgentDependencyBlock } from "@/lib/server/agent-management-dependencies";
import {
  describeAgentContextFailure,
  isAgentArchivedMetadata,
  resolveAgentContextSaveDecision,
  validateAgentId,
  validateAgentManagementPayload,
} from "@/lib/server/agent-management-validation";
import { rowToAgent } from "@/lib/server/tenant-agents-db";
import {
  archiveTenantAgentAtomic,
  saveTenantAgentAtomic,
} from "@/lib/server/agent-management-persistence";

export const dynamic = "force-dynamic";

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const BASE_AGENT_SELECT = "agent_id, display_name, system_prompt, model, active, metadata, created_at, updated_at, voice_id, response_mode";
const AGENT_SELECT_WITH_CRM = `${BASE_AGENT_SELECT}, crm_auto_move_enabled, crm_target_funnel_id, crm_target_column_id, crm_target_status`;

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes("crm_auto_move_enabled");
}

// ---------------------------------------------------------------------------
// PUT — atualiza somente um agente já pertencente ao tenant.
// ---------------------------------------------------------------------------

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session, canManageExternalApis } = guard.value;

  const agentId = params.id?.trim() ?? "";
  const idError = validateAgentId(agentId);
  if (idError) return NextResponse.json({ error: idError }, { status: 400 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const validation = validateAgentManagementPayload(payload, {
    requireId: true,
    expectedId: agentId,
    requireVersion: true,
  });
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

  const sb = createSupabaseServiceClient();
  const existing = await sb
    .from("tenant_agents")
    .select(`${BASE_AGENT_SELECT},config_version,archived_at,review_reasons`)
    .eq("tenant_id", session.tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (existing.error) {
    console.error("[api/client/agentes] PUT lookup", existing.error.code, existing.error.message);
    return NextResponse.json({ error: "Erro ao carregar agente." }, { status: 503 });
  }
  if (!existing.data || existing.data.archived_at || isAgentArchivedMetadata(existing.data.metadata)) {
    return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });
  }
  if (Date.parse(String(existing.data.updated_at)) !== Date.parse(agent.atualizadoEm)) {
    return NextResponse.json(
      { error: "Este agente foi alterado em outra sessão. Recarregue antes de salvar.", code: "AGENT_VERSION_CONFLICT" },
      { status: 409 },
    );
  }

  const contextDecision = resolveAgentContextSaveDecision({
    agent,
    model: typeof existing.data.model === "string" ? existing.data.model : null,
    existingReviewReasons: existing.data.review_reasons,
  });
  if (contextDecision.blocked && !contextDecision.validation.ok) {
    return NextResponse.json(
      describeAgentContextFailure(contextDecision.validation),
      { status: 422 },
    );
  }

  if (existing.data.active === true && agent.status !== "ativo") {
    const dependencyBlock = await describeAgentDependencyBlock({
      sb,
      tenantId: session.tenantId,
      agentId,
      kind: "pause",
    });
    if (dependencyBlock) {
      return NextResponse.json(
        { error: dependencyBlock.message, code: dependencyBlock.code },
        { status: dependencyBlock.code === "AGENT_DEPENDENCY_CHECK_FAILED" ? 503 : 409 },
      );
    }
  }
  // Cota de agente de Disparos é separada da de atendimento — quem decide é o
  // próprio payload que está sendo salvo, não o estado antigo no banco.
  const isBroadcastAgent = agentId === DISPAROS_DEFAULT_AGENT_ID || isBroadcastAgentMetadata(agent);
  const activationBlock = await describeAgentActivationBlock({
    sb,
    session,
    agentId,
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
  const existingConnectorIds = await listAgentExternalApiConnectorIds(session.tenantId, agentId);
  let requestedConnectorIds = canManageExternalApis && Array.isArray(agent.externalApiConnectorIds) ? agent.externalApiConnectorIds : existingConnectorIds;
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
      agentId,
      createOnly: false,
      expectedVersion: Number(existing.data.config_version),
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
    if (message.includes("agent_version_conflict")) {
      return NextResponse.json(
        { error: "Este agente foi alterado em outra sessão. Recarregue antes de salvar.", code: "AGENT_VERSION_CONFLICT" },
        { status: 409 },
      );
    }
    console.error("[api/client/agentes] PUT atomic", { error: message });
    return NextResponse.json({ error: "Erro ao atualizar agente." }, { status: 503 });
  }
  if (!saved.ok) {
    return NextResponse.json(
      { error: "Existem vínculos ativos. Transfira ou desative-os antes de pausar.", code: saved.code, dependencies: saved.dependencies },
      { status: 409 },
    );
  }
  if (!saved.row) return NextResponse.json({ error: "Erro ao carregar o agente salvo." }, { status: 503 });
  const updated = rowToAgent(saved.row, session.tenantId);
  if (canManageExternalApis) updated.externalApiConnectorIds = requestedConnectorIds;
  else delete updated.externalApiConnectorIds;
  return NextResponse.json({ agent: updated });
}

// ---------------------------------------------------------------------------
// DELETE — remove agente do tenant
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;

  const agentId = params.id?.trim() ?? "";
  const idError = validateAgentId(agentId);
  if (idError) return NextResponse.json({ error: idError }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const existing = await sb
    .from("tenant_agents")
    .select("metadata,active,config_version,archived_at")
    .eq("tenant_id", session.tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (existing.error) {
    console.error("[api/client/agentes] DELETE lookup", existing.error.code, existing.error.message);
    return NextResponse.json({ error: "Erro ao carregar agente." }, { status: 503 });
  }
  if (!existing.data || existing.data.archived_at || isAgentArchivedMetadata(existing.data.metadata)) {
    return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });
  }

  const dependencyBlock = await describeAgentDependencyBlock({
    sb,
    tenantId: session.tenantId,
    agentId,
    kind: "archive",
  });
  if (dependencyBlock) {
    return NextResponse.json(
      { error: dependencyBlock.message, code: dependencyBlock.code },
      { status: dependencyBlock.code === "AGENT_DEPENDENCY_CHECK_FAILED" ? 503 : 409 },
    );
  }

  try {
    const archived = await archiveTenantAgentAtomic({
      sb,
      tenantId: session.tenantId,
      agentId,
      expectedVersion: Number(existing.data.config_version),
      archivedBy: session.email,
    });
    if (!archived.ok) {
      return NextResponse.json(
        { error: "Ainda existem vínculos ativos. Transfira ou desative-os antes de arquivar.", code: archived.code, dependencies: archived.dependencies },
        { status: 409 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent_archive_failed";
    const conflict = message.includes("agent_version_conflict");
    return NextResponse.json(
      { error: conflict ? "Este agente foi alterado em outra sessão. Recarregue antes de excluir." : "Erro ao arquivar agente.", code: conflict ? "AGENT_VERSION_CONFLICT" : "AGENT_ARCHIVE_FAILED" },
      { status: conflict ? 409 : 503 },
    );
  }

  return NextResponse.json({ ok: true, archived: true });
}
