import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildTemplateAgentsForTenant } from "@/lib/agents/template-agents";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

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
  // If full Agent was stored in metadata, use it (with DB overrides for live fields)
  if (row.metadata && typeof row.metadata === "object") {
    const meta = row.metadata as Agent;
    return {
      ...meta,
      id: String(row.agent_id),
      clientId: tenantId,
      nome: String(row.display_name ?? meta.nome),
      status: (row.active as boolean) ? "ativo" : "pausado",
      atualizadoEm: String(row.updated_at ?? meta.atualizadoEm),
      voiceId: (row.voice_id as string | null) ?? meta.voiceId ?? null,
      responseMode: ((row.response_mode as string | null) === "audio" ? "audio" : "text") as "text" | "audio",
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
    voiceId: (row.voice_id as string | null) ?? null,
    responseMode: ((row.response_mode as string | null) === "audio" ? "audio" : "text") as "text" | "audio",
  };
}

// ---------------------------------------------------------------------------
// GET — lista agentes do tenant
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id, display_name, system_prompt, model, active, metadata, created_at, updated_at, voice_id, response_mode")
    .eq("tenant_id", session.tenantId)
    .order("updated_at", { ascending: false });

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

  const sb = createSupabaseServiceClient();
  const systemPrompt = assembleSystemPrompt(agent);
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("tenant_agents")
    .upsert(
      {
        tenant_id: session.tenantId,
        agent_id: agent.id,
        display_name: agent.nome.trim(),
        system_prompt: systemPrompt || agent.systemPrompt || "",
        model: null,
        active: agent.status === "ativo",
        metadata: agent,
        updated_at: now,
        voice_id: agent.voiceId ?? null,
        response_mode: agent.responseMode ?? "text",
      },
      { onConflict: "tenant_id,agent_id" },
    )
    .select("agent_id, display_name, system_prompt, model, active, metadata, created_at, updated_at, voice_id, response_mode")
    .single();

  if (error) {
    console.error("[api/client/agentes] POST", error.code, error.message);
    return NextResponse.json({ error: "Erro ao criar agente." }, { status: 503 });
  }

  const created = rowToAgent(data as Record<string, unknown>, session.tenantId);
  return NextResponse.json({ agent: created }, { status: 201 });
}
