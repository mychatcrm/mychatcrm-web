import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
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
import type { Agent } from "@/lib/types";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { listAgentExternalApiConnectorIds, syncAgentExternalApiConnectors } from "@/lib/server/external-api-connectors";

export const dynamic = "force-dynamic";

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const BASE_AGENT_SELECT = "agent_id, display_name, system_prompt, model, active, metadata, created_at, updated_at, voice_id, response_mode";
const AGENT_SELECT_WITH_CRM = `${BASE_AGENT_SELECT}, crm_auto_move_enabled, crm_target_funnel_id, crm_target_column_id, crm_target_status`;

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes("crm_auto_move_enabled");
}

// ---------------------------------------------------------------------------
// PUT — upsert agente (cria se não existir, atualiza se já existir)
// Usa upsert em vez de update para garantir que templates editados pela
// primeira vez sejam persistidos mesmo sem row prévia no banco.
// ---------------------------------------------------------------------------

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const agentId = params.id;
  if (!agentId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  let agent: Agent;
  try {
    agent = (await request.json()) as Agent;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  // O upsert abaixo grava `agent.nome.trim()` em display_name; sem esta guarda
  // um corpo sem nome derruba a rota com TypeError em vez de responder 400.
  if (!agent.nome?.trim()) {
    return NextResponse.json({ error: "Campo obrigatório em falta (nome)." }, { status: 400 });
  }
  const responseSettingsError = validateAgentResponseSettings(agent);
  if (responseSettingsError) {
    return NextResponse.json({ error: responseSettingsError }, { status: 400 });
  }
  const crmDestinationError = validateAgentCrmDestination(agent);
  if (crmDestinationError) {
    return NextResponse.json({ error: crmDestinationError }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
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
  const now = new Date().toISOString();
  const responseSettings = sanitizeAgentResponseSettings(agent);
  const normalizedCrmDestination = normalizeAgentCrmDestination(agent);
  const crmDestination = agentCrmDestinationDbFields(agent);
  const canManageExternalApis = resolveOrganizationRole(session) === "owner";
  const existingConnectorIds = await listAgentExternalApiConnectorIds(session.tenantId, agentId);
  const requestedConnectorIds = canManageExternalApis && Array.isArray(agent.externalApiConnectorIds) ? agent.externalApiConnectorIds : existingConnectorIds;
  const metadataAgent = { ...agent }; delete metadataAgent.externalApiConnectorIds;

  const initial = await sb
    .from("tenant_agents")
    .upsert(
      {
        tenant_id: session.tenantId,
        agent_id: agentId,
        display_name: agent.nome.trim(),
        system_prompt: systemPrompt || agent.systemPrompt || "",
        model: null,
        active: agent.status === "ativo",
        metadata: { ...metadataAgent, ...responseSettings, ...normalizedCrmDestination },
        updated_at: now,
        voice_id: responseSettings.voiceId,
        response_mode: responseSettings.responseMode,
        ...crmDestination,
      },
      { onConflict: "tenant_id,agent_id" },
    )
    .select(AGENT_SELECT_WITH_CRM)
    .single();
  let error = initial.error;

  if (isMissingColumnError(error)) {
    const fallback = await sb
      .from("tenant_agents")
      .upsert(
        {
          tenant_id: session.tenantId,
          agent_id: agentId,
          display_name: agent.nome.trim(),
          system_prompt: systemPrompt || agent.systemPrompt || "",
          model: null,
          active: agent.status === "ativo",
          metadata: { ...metadataAgent, ...responseSettings, ...normalizedCrmDestination },
          updated_at: now,
          voice_id: responseSettings.voiceId,
          response_mode: responseSettings.responseMode,
        },
        { onConflict: "tenant_id,agent_id" },
      )
      .select(BASE_AGENT_SELECT)
      .single();
    error = fallback.error;
  }

  if (error) {
    console.error("[api/client/agentes] PUT", error.code, error.message);
    return NextResponse.json({ error: "Erro ao atualizar agente." }, { status: 503 });
  }

  if (canManageExternalApis) await syncAgentExternalApiConnectors(session.tenantId, agentId, requestedConnectorIds);

  return NextResponse.json({
    agent: {
      ...agent,
      ...responseSettings,
      ...normalizedCrmDestination,
      ...(canManageExternalApis ? { externalApiConnectorIds: requestedConnectorIds } : {}),
      atualizadoEm: now,
    },
  });
}

// ---------------------------------------------------------------------------
// DELETE — remove agente do tenant
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const agentId = params.id;
  if (!agentId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("tenant_agents")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("agent_id", agentId);

  if (error) {
    console.error("[api/client/agentes] DELETE", error.code, error.message);
    return NextResponse.json({ error: "Erro ao remover agente." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
