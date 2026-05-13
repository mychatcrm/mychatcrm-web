/**
 * POST /api/client/conversas/resume
 * Reativa o agente de IA para uma conversa pausada (takeover manual, comando ou handoff).
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resumeConversationFromPanel } from "@/lib/server/conversation-human-control";
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
  await resumeConversationFromPanel({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    agentId: instance?.default_agent_id ?? null,
  });

  return NextResponse.json({ ok: true });
}
