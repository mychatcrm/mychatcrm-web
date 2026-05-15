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
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const BASE_AGENT_SELECT = "agent_id, display_name, system_prompt, model, active, metadata, created_at, updated_at, voice_id, response_mode";
const AGENT_SELECT_WITH_CRM = `${BASE_AGENT_SELECT}, crm_auto_move_enabled, crm_target_funnel_id, crm_target_column_id, crm_target_status`;

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes("crm_auto_move_enabled");
}

async function linkAgentToWhatsAppSlot(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  agentId: string;
  slotIndex?: number | null;
}): Promise<void> {
  if (!Number.isFinite(params.slotIndex)) return;
  const slotIndex = Math.max(0, Math.floor(Number(params.slotIndex)));
  const { error } = await params.sb
    .from("tenant_evolution_instances")
    .update({ default_agent_id: params.agentId, updated_at: new Date().toISOString() })
    .eq("tenant_id", params.tenantId)
    .eq("slot_index", slotIndex);
  if (error && !isMissingColumnError(error)) {
    console.warn("[api/client/agentes] WhatsApp slot link", error.code, error.message);
  }
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
  const crmDestinationError = validateAgentCrmDestination(agent);
  if (crmDestinationError) {
    return NextResponse.json({ error: crmDestinationError }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const systemPrompt = assembleStoredSystemPrompt(agent);
  const now = new Date().toISOString();
  const responseSettings = sanitizeAgentResponseSettings(agent);
  const normalizedCrmDestination = normalizeAgentCrmDestination(agent);
  const crmDestination = agentCrmDestinationDbFields(agent);

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
          metadata: { ...agent, ...responseSettings, ...normalizedCrmDestination },
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

  await linkAgentToWhatsAppSlot({
    sb,
    tenantId: session.tenantId,
    agentId,
    slotIndex: agent.whatsappSlotIndex,
  });

  return NextResponse.json({
    agent: {
      ...agent,
      ...responseSettings,
      ...normalizedCrmDestination,
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
