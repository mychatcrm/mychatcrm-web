import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getAiOverview, parseAiRange } from "@/lib/ai/admin-metrics";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const range = parseAiRange(new URL(request.url).searchParams);
  const payload = await getAiOverview(range);
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
