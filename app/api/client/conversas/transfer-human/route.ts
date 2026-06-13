import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { transferConversationToWaiting } from "@/lib/server/conversation-operation";

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
  if (!remoteJid) return NextResponse.json({ error: "remoteJid é obrigatório" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const actorId = session.employeeId ?? session.email;
  const result = await transferConversationToWaiting({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    actorId,
    actorName: session.displayName,
  });

  return NextResponse.json({ ok: true, operation: result.operation });
}
