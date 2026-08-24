import { NextResponse } from "next/server";
import { resolveConfiguredConversationLanguage } from "@/lib/ai/language-detect";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";
import { loadAgentRuntimeContext } from "@/lib/server/conversation-memory";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Agent } from "@/lib/types";
import { assertManageableTenantAgent } from "@/lib/server/agent-management-record";
import { simulateAgentTurnV2 } from "@/lib/server/process-agent-turn-v2";

export const dynamic = "force-dynamic";

function rowAgent(row: Record<string, unknown>, agentId: string): Partial<Agent> & { nome?: string; systemPrompt?: string } {
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Partial<Agent>) : {};
  const hasCurrentPromptFields = [
    "instructionMode",
    "simplePrompt",
    "promptIdentidade",
    "promptObjetivo",
    "systemPrompt",
    "promptRegrasAdicionais",
    "respostasProibidas",
  ].some((key) => Object.prototype.hasOwnProperty.call(metadata, key));
  return {
    ...metadata,
    nome: typeof row.display_name === "string" ? row.display_name : metadata.nome ?? agentId,
    systemPrompt: hasCurrentPromptFields
      ? metadata.systemPrompt ?? ""
      : typeof row.system_prompt === "string"
        ? row.system_prompt
        : "",
  };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;
  const { session } = guard.value;

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
  try {
    await assertManageableTenantAgent(sb, session.tenantId, agentId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agente não encontrado." },
      { status: 404 },
    );
  }
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id, display_name, system_prompt, model, metadata, review_reasons")
    .eq("tenant_id", session.tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();

  if (error) {
    console.error("[api/client/agentes/simulate]", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar agente." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });

  const agent = { ...rowAgent(data as Record<string, unknown>, agentId), ...(body.draft ?? {}) };
  const language = resolveConfiguredConversationLanguage(agent.idioma, message);
  const runtimeContext = await loadAgentRuntimeContext({
    tenantId: session.tenantId,
    agentId,
    remoteJid: body.remoteJid ?? null,
    query: message,
  });

  const result = await simulateAgentTurnV2({
    sb,
    tenantId: session.tenantId,
    agentId,
    remoteJid: body.remoteJid ?? null,
    message,
    model: typeof data.model === "string" ? data.model : undefined,
    agent,
    reviewReasons: Array.isArray(data.review_reasons)
      ? data.review_reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    reply: result.decision.reply,
    simulation: true,
    decision: {
      authorization: result.decision.authorization,
      language: result.decision.languageTag ?? result.decision.languageCode,
      materials: runtimeContext.knowledgeSnippets.length,
      externalApiLookups: result.decision.externalApiLookups,
      handoff: result.decision.handoff,
      agenda: {
        plan: result.decision.agenda,
        blocked: result.decision.agendaBlocked,
        mutated: false,
      },
      media: result.decision.media,
      outboundSent: false,
    },
    contextUsed: {
      identity: Boolean(agent.promptIdentidade || agent.nome),
      objective: Boolean(agent.promptObjetivo || agent.objetivo),
      rules: Boolean(agent.promptRegrasAdicionais || agent.respostasProibidas),
      materials: runtimeContext.knowledgeSnippets.length,
      outboundMedia: runtimeContext.outboundMediaLines.length,
      history: runtimeContext.recentMessages.length,
      summary: Boolean(runtimeContext.summary),
      lead: Boolean(runtimeContext.lead),
      language: language.ok ? language.tag ?? "und" : `invalid:${language.value}`,
      remoteJid: body.remoteJid ?? null,
    },
  });
}
