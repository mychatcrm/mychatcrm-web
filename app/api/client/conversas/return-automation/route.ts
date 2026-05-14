/**
 * POST /api/client/conversas/return-automation
 * Retorna conversa para automação e bloqueia envio humano.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { returnConversationToAutomation } from "@/lib/server/conversation-operation";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";

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

  const instance = await getEvolutionInstanceByTenantId(session.tenantId);
  const sb = createSupabaseServiceClient();
  const actorId = session.employeeId ?? session.email;
  const result = await returnConversationToAutomation({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    actorId,
    actorName: session.displayName,
    agentId: instance?.default_agent_id ?? null,
  });

  return NextResponse.json({ ok: true, operation: result.operation });
}
