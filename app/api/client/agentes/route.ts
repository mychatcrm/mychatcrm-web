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
import {
  AGENT_SELECT_WITH_CRM,
  BASE_AGENT_SELECT,
  isMissingColumnError,
  rowToAgent,
} from "@/lib/server/tenant-agents-db";
import { describeAgentActivationBlock } from "@/lib/server/agent-plan-limit";
import type { Agent } from "@/lib/types";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { syncAgentExternalApiConnectors } from "@/lib/server/external-api-connectors";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET — lista agentes do tenant
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

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

  const agents: Agent[] = (data ?? []).map((row) =>
    rowToAgent(row as Record<string, unknown>, session.tenantId),
  );
  const owner = resolveOrganizationRole(session) === "owner";
  if (owner && agents.length) {
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
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let agent: Agent;
  try {
    agent = (await request.json()) as Agent;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!agent.id || !agent.nome?.trim()) {
    return NextResponse.json({ error: "Campos obrigatórios em falta (id, nome)." }, { status: 400 });
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
  const activationBlock = await describeAgentActivationBlock({
    sb,
    session,
    agentId: agent.id,
    willBeActive: agent.status === "ativo",
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
  const requestedConnectorIds = canManageExternalApis && Array.isArray(agent.externalApiConnectorIds) ? agent.externalApiConnectorIds : [];
  const metadataAgent = { ...agent }; delete metadataAgent.externalApiConnectorIds;

  const initial = await sb
    .from("tenant_agents")
    .upsert(
      {
        tenant_id: session.tenantId,
        agent_id: agent.id,
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
  let data: unknown = initial.data;
  let error = initial.error;

  if (isMissingColumnError(error)) {
    const { data: fallbackData, error: fallbackError } = await sb
      .from("tenant_agents")
      .upsert(
        {
          tenant_id: session.tenantId,
          agent_id: agent.id,
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
    data = fallbackData as unknown;
    error = fallbackError;
  }

  if (error) {
    console.error("[api/client/agentes] POST", error.code, error.message);
    return NextResponse.json({ error: "Erro ao criar agente." }, { status: 503 });
  }

  if (canManageExternalApis) await syncAgentExternalApiConnectors(session.tenantId, agent.id, requestedConnectorIds);

  const created = rowToAgent(data as Record<string, unknown>, session.tenantId);
  if (canManageExternalApis) created.externalApiConnectorIds = requestedConnectorIds;
  return NextResponse.json({ agent: created }, { status: 201 });
}
