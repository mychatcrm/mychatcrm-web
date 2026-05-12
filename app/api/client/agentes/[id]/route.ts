import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sanitizeAgentResponseSettings, validateAgentResponseSettings } from "@/lib/agents";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

function assembleSystemPrompt(agent: Agent): string {
  const parts = [
    agent.systemPrompt,
    agent.promptIdentidade,
    agent.promptObjetivo,
    agent.promptRegrasAdicionais ? `Regras adicionais:\n${agent.promptRegrasAdicionais}` : null,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.join("\n\n");
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes("crm_auto_move_enabled");
}

function agentCrmDestinationDbFields(agent: Agent): Record<string, unknown> {
  const enabled = Boolean(agent.crmAutoMoveEnabled);
  const targetColumn = enabled ? (agent.crmTargetColumnId ?? agent.crmTargetStatus ?? null) : null;
  return {
    crm_auto_move_enabled: enabled,
    crm_target_funnel_id: enabled ? (agent.crmTargetFunnelId ?? null) : null,
    crm_target_column_id: targetColumn,
    crm_target_status: targetColumn,
  };
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
  const responseSettingsError = validateAgentResponseSettings(agent);
  if (responseSettingsError) {
    return NextResponse.json({ error: responseSettingsError }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const systemPrompt = assembleSystemPrompt(agent);
  const now = new Date().toISOString();
  const responseSettings = sanitizeAgentResponseSettings(agent);
  const crmDestination = agentCrmDestinationDbFields(agent);

  let { error } = await sb
    .from("tenant_agents")
    .upsert(
      {
        tenant_id: session.tenantId,
        agent_id: agentId,
        display_name: agent.nome.trim(),
        system_prompt: systemPrompt || agent.systemPrompt || "",
        model: null,
        active: agent.status === "ativo",
        metadata: { ...agent, ...responseSettings, ...crmDestination },
        updated_at: now,
        voice_id: responseSettings.voiceId,
        response_mode: responseSettings.responseMode,
        ...crmDestination,
      },
      { onConflict: "tenant_id,agent_id" },
    );

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
          metadata: { ...agent, ...responseSettings, ...crmDestination },
          updated_at: now,
          voice_id: responseSettings.voiceId,
          response_mode: responseSettings.responseMode,
        },
        { onConflict: "tenant_id,agent_id" },
      );
    error = fallback.error;
  }

  if (error) {
    console.error("[api/client/agentes] PUT", error.code, error.message);
    return NextResponse.json({ error: "Erro ao atualizar agente." }, { status: 503 });
  }

  return NextResponse.json({
    agent: {
      ...agent,
      ...responseSettings,
      crmAutoMoveEnabled: Boolean(agent.crmAutoMoveEnabled),
      crmTargetFunnelId: agent.crmAutoMoveEnabled ? (agent.crmTargetFunnelId ?? null) : null,
      crmTargetColumnId: agent.crmAutoMoveEnabled ? (agent.crmTargetColumnId ?? agent.crmTargetStatus ?? null) : null,
      crmTargetStatus: agent.crmAutoMoveEnabled ? (agent.crmTargetColumnId ?? agent.crmTargetStatus ?? null) : null,
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
