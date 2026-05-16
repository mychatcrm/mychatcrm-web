import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { buildAgentDebugSystemPrompt } from "@/lib/ai/generate-agent-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId")?.trim();
  const agentId = url.searchParams.get("agentId")?.trim();
  const conversationId = url.searchParams.get("conversationId")?.trim() || null;
  const message = url.searchParams.get("message")?.trim() || null;

  if (!tenantId || !agentId) {
    return NextResponse.json(
      { error: "tenantId e agentId são obrigatórios." },
      { status: 400 },
    );
  }

  const debug = await buildAgentDebugSystemPrompt({
    tenantId,
    agentId,
    conversationId,
    message,
  });
  if (!debug.ok) {
    return NextResponse.json(
      { error: debug.detail, code: debug.code },
      { status: debug.code === "INVALID_INPUT" ? 404 : 400 },
    );
  }

  return NextResponse.json(
    {
      tenantId,
      agentId,
      conversationId,
      probeMessage: message || "Quero ver fotos e materiais disponíveis.",
      model: debug.model,
      temperature: debug.temperature,
      detectedLanguage: debug.detectedLanguage,
      promptLength: debug.systemPrompt.length,
      hasOutboundMediaBlock: debug.systemPrompt.includes("ARQUIVOS DISPONÍVEIS PARA ENVIO"),
      outboundMediaLinesCount: debug.outboundMediaLines.length,
      outboundMediaLines: debug.outboundMediaLines,
      knowledgeSnippetsCount: debug.knowledgeSnippetsCount,
      recentMessagesCount: debug.recentMessagesCount,
      systemPrompt: debug.systemPrompt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
