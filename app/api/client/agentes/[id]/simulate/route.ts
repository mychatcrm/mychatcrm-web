import { NextResponse } from "next/server";
import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { detectSupportedLanguageCode, supportedLanguageName } from "@/lib/ai/language-detect";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { loadAgentRuntimeContext } from "@/lib/server/conversation-memory";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

function rowAgent(row: Record<string, unknown>, agentId: string): Partial<Agent> & { nome?: string; systemPrompt?: string } {
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Partial<Agent>) : {};
  return {
    ...metadata,
    nome: typeof row.display_name === "string" ? row.display_name : metadata.nome ?? agentId,
    systemPrompt: typeof row.system_prompt === "string" ? row.system_prompt : metadata.systemPrompt ?? "",
  };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const agentId = params.id?.trim();
  if (!agentId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  let body: { message?: string; draft?: Partial<Agent>; remoteJid?: string | null };
  try {
    body = (await request.json()) as { message?: string; draft?: Partial<Agent>; remoteJid?: string | null };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "Mensagem de teste obrigatória." }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id, display_name, system_prompt, model, metadata")
    .eq("tenant_id", session.tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();

  if (error) {
    console.error("[api/client/agentes/simulate]", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar agente." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });

  const agent = { ...rowAgent(data as Record<string, unknown>, agentId), ...(body.draft ?? {}) };
  const languageName = supportedLanguageName(detectSupportedLanguageCode(message));
  const runtimeContext = await loadAgentRuntimeContext({
    tenantId: session.tenantId,
    agentId,
    remoteJid: body.remoteJid ?? null,
  });

  const result = await generateAgentResponse({
    tenantId: session.tenantId,
    agentId,
    conversationId: body.remoteJid ?? null,
    feature: "agent_completion",
    messages: [{ role: "user", content: message }],
    model: typeof data.model === "string" ? data.model : undefined,
    simulation: true,
    agentOverride: agent,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.detail ?? result.code }, { status: 502 });
  }

  return NextResponse.json({
    reply: result.text,
    simulation: true,
    contextUsed: {
      identity: Boolean(agent.promptIdentidade || agent.nome),
      objective: Boolean(agent.promptObjetivo || agent.objetivo),
      rules: Boolean(agent.promptRegrasAdicionais || agent.respostasProibidas),
      materials: runtimeContext.knowledgeSnippets.length,
      history: runtimeContext.recentMessages.length,
      summary: Boolean(runtimeContext.summary),
      lead: Boolean(runtimeContext.lead),
      language: languageName,
      remoteJid: body.remoteJid ?? null,
    },
  });
}
