/**
 * POST /api/client/conversas/takeover
 * Humano assume atendimento: pausa IA, libera input e registra transferência.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conversationInScope, resolveAccessScope } from "@/lib/server/access-scope";
import { takeoverConversation } from "@/lib/server/conversation-operation";
import { resolveConversationAgentId } from "@/lib/server/conversation-agent-resolve";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: { remoteJid?: string };
  try {
    body = (await request.json()) as { remoteJid?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const remoteJid = body.remoteJid?.trim();
  if (!remoteJid) {
    return NextResponse.json({ error: "remoteJid é obrigatório" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  if (!(await conversationInScope(sb, session.tenantId, remoteJid, await resolveAccessScope(sb, session)))) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const actorId = session.employeeId ?? session.email;
  try {
    const result = await takeoverConversation({
      sb,
      tenantId: session.tenantId,
      remoteJid,
      actorId,
      actorName: session.displayName,
      agentId: await resolveConversationAgentId({ sb, tenantId: session.tenantId, remoteJid }),
    });
    return NextResponse.json({ ok: true, operation: result.operation });
  } catch (error) {
    console.error("[conversation-takeover] atomic_operation_failed", {
      tenant_id: session.tenantId,
      error: error instanceof Error ? error.message : "takeover_failed",
    });
    return NextResponse.json(
      { ok: false, error: "Não foi possível assumir a conversa. Nada foi alterado." },
      { status: 503 },
    );
  }
}
