import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getAiTopAgents, parseAiRange } from "@/lib/ai/admin-metrics";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const range = parseAiRange(new URL(request.url).searchParams);
  const rows = await getAiTopAgents(range);
  return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
}
