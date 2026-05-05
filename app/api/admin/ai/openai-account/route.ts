import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { fetchOpenAiAccountSnapshot } from "@/lib/server/openai-billing";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  try {
    const snapshot = await fetchOpenAiAccountSnapshot();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao consultar OpenAI.";
    console.error("[admin/ai/openai-account]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
