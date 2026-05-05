import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getAiLogs, parseAiRange } from "@/lib/ai/admin-metrics";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const range = parseAiRange(url.searchParams);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? 50)));
  const payload = await getAiLogs(range, page, pageSize);
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
