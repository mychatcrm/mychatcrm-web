import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

function assembleSystemPrompt(agent: Agent): string {
  const parts = [
    agent.systemPrompt,
    agent.promptIdentidade,
    agent.promptObjetivo,
    agent.promptRegrasAdicionais ? `Regras adicionais:\n${agent.promptRegrasAdicionais}` : null,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.join("\n\n");
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

  const sb = createSupabaseServiceClient();
  const systemPrompt = assembleSystemPrompt(agent);
  const now = new Date().toISOString();

  const { error } = await sb
    .from("tenant_agents")
    .upsert(
      {
        tenant_id: session.tenantId,
        agent_id: agentId,
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
    );

  if (error) {
    console.error("[api/client/agentes] PUT", error.code, error.message);
    return NextResponse.json({ error: "Erro ao atualizar agente." }, { status: 503 });
  }

  return NextResponse.json({ agent: { ...agent, atualizadoEm: now } });
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
