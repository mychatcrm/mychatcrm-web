/**
 * POST /api/client/conversas/return-automation
 * Retorna conversa para automação e bloqueia envio humano.
 *
 * A retomada não escolhe um agente por fallback. Ela só preserva a automação
 * de uma jornada ativa que ainda esteja autorizada para aquele canal.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conversationInScope, resolveAccessScope } from "@/lib/server/access-scope";
import { returnConversationToAutomation } from "@/lib/server/conversation-operation";
import { authorizeActiveJourney, isJourneyIsolationEnabled } from "@/lib/server/lead-journeys";

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


  let agentId: string | null = null;
  if (isJourneyIsolationEnabled()) {
    const journey = await authorizeActiveJourney({
      sb,
      tenantId: session.tenantId,
      remoteJid,
    });
    if (!journey.ok) {
      return NextResponse.json(
        { error: "A jornada original não está mais autorizada para automação.", reason: journey.reason },
        { status: 409 },
      );
    }
    agentId = journey.agentId;
  } else {
    return NextResponse.json(
      { error: "O isolamento omnichannel precisa estar ativo para retomar a automação." },
      { status: 409 },
    );
  }

  const actorId = session.employeeId ?? session.email;
  const result = await returnConversationToAutomation({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    actorId,
    actorName: session.displayName,
    agentId,
  });

  return NextResponse.json({ ok: true, operation: result.operation });
}
