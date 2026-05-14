import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { broadcastAgendaChange } from "@/lib/server/agenda-realtime";
import { syncGoogleCalendarToDatabase } from "@/lib/server/google-calendar";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  try {
    const result = await syncGoogleCalendarToDatabase(session.tenantId);
    await broadcastAgendaChange(session.tenantId, "update");
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha na sincronização";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
