import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getAiIntegrationStatus } from "@/lib/ai/admin-integration-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  try {
    const payload = await getAiIntegrationStatus();
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao ler estado da integração.";
    console.error("[admin/ai/integration-status]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
