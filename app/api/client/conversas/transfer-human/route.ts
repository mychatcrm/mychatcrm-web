import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { transferConversationToWaiting } from "@/lib/server/conversation-operation";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: { remoteJid?: string; targetEmployeeId?: string };
  try {
    body = (await request.json()) as { remoteJid?: string; targetEmployeeId?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const remoteJid = body.remoteJid?.trim();
  if (!remoteJid) return NextResponse.json({ error: "remoteJid é obrigatório" }, { status: 400 });

  let targetEmployeeName: string | null = null;
  if (body.targetEmployeeId) {
    const employees = await readTeamMembersFromDb(session.tenantId);
    const found = employees.find((e) => e.id === body.targetEmployeeId);
    targetEmployeeName = found?.nome ?? null;
  }

  const sb = createSupabaseServiceClient();
  const actorId = session.employeeId ?? session.email;
  const result = await transferConversationToWaiting({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    actorId,
    actorName: session.displayName,
    targetEmployeeId: body.targetEmployeeId ?? null,
    targetEmployeeName,
  });

  return NextResponse.json({ ok: true, operation: result.operation });
}
