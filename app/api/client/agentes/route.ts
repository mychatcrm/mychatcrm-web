import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildTemplateAgentsForTenant } from "@/lib/agents/template-agents";
import {
  agentCrmDestinationDbFields,
  normalizeAgentCrmDestination,
  normalizeAgentVoiceId,
  sanitizeAgentResponseSettings,
  validateAgentCrmDestination,
  validateAgentResponseSettings,
} from "@/lib/agents";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

const BASE_AGENT_SELECT = "agent_id, display_name, system_prompt, model, active, metadata, created_at, updated_at, voice_id, response_mode";
const AGENT_SELECT_WITH_CRM = `${BASE_AGENT_SELECT}, crm_auto_move_enabled, crm_target_funnel_id, crm_target_column_id, crm_target_status`;
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assembleSystemPrompt(agent: Agent): string {
  const parts = [
    agent.systemPrompt,
    agent.promptIdentidade,
    agent.promptObjetivo,
    agent.promptRegrasAdicionais ? `Regras adicionais:\n${agent.promptRegrasAdicionais}` : null,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.join("\n\n");
}

function rowToAgent(row: Record<string, unknown>, tenantId: string): Agent {
  const responseSettings = sanitizeAgentResponseSettings({
    responseMode: row.response_mode,
    voiceId: row.voice_id,
  });
  const hasCrmColumns = Object.prototype.hasOwnProperty.call(row, "crm_auto_move_enabled");
  const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Agent) : null;
  const crmDestination = normalizeAgentCrmDestination(
    hasCrmColumns
      ? {
          crmAutoMoveEnabled: row.crm_auto_move_enabled === true,
          crmTargetFunnelId: typeof row.crm_target_funnel_id === "string" ? row.crm_target_funnel_id : null,
          crmTargetColumnId: typeof row.crm_target_column_id === "string" ? row.crm_target_column_id : null,
          crmTargetStatus: typeof row.crm_target_status === "string" ? row.crm_target_status : null,
        }
      : (meta ?? {}),
  );

  // If full Agent was stored in metadata, use it (with DB overrides for live fields)
  if (meta) {
    return {
      ...meta,
      id: String(row.agent_id),
      clientId: tenantId,
      nome: String(row.display_name ?? meta.nome),
      status: (row.active as boolean) ? "ativo" : "pausado",
      atualizadoEm: String(row.updated_at ?? meta.atualizadoEm),
      voiceId:
        responseSettings.responseMode === "audio"
          ? responseSettings.voiceId ?? normalizeAgentVoiceId(meta.voiceId)
          : null,
      responseMode: responseSettings.responseMode,
      ...crmDestination,
    };
  }

  // Reconstruct from templates as base, override with DB fields
  const templates = buildTemplateAgentsForTenant(tenantId);
  const base = structuredClone(templates[0]!);
  return {
    ...base,
    id: String(row.agent_id),
    clientId: tenantId,
    nome: String(row.display_name ?? "Agente"),
    systemPrompt: String(row.system_prompt ?? base.systemPrompt),
    status: (row.active as boolean) ? "ativo" : "pausado",
    criadoEm: String(row.created_at ?? base.criadoEm),
    atualizadoEm: String(row.updated_at ?? base.atualizadoEm),
    voiceId: responseSettings.voiceId,
    responseMode: responseSettings.responseMode,
    ...crmDestination,
  };
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes("crm_auto_move_enabled");
}

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
  const systemPrompt = assembleSystemPrompt(agent);
  const now = new Date().toISOString();
  const responseSettings = sanitizeAgentResponseSettings(agent);
  const normalizedCrmDestination = normalizeAgentCrmDestination(agent);
  const crmDestination = agentCrmDestinationDbFields(agent);

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
        metadata: { ...agent, ...responseSettings, ...normalizedCrmDestination },
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
          metadata: { ...agent, ...responseSettings, ...normalizedCrmDestination },
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

  const created = rowToAgent(data as Record<string, unknown>, session.tenantId);
  return NextResponse.json({ agent: created }, { status: 201 });
}
