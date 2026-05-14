import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { syncGoogleCalendarToDatabase } from "@/lib/server/google-calendar";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  try {
    const result = await syncGoogleCalendarToDatabase(session.tenantId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha na sincronização";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
