import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { withOpenAiAccountCache } from "@/lib/server/openai-account-cache";
import { fetchOpenAiAccountSnapshot } from "@/lib/server/openai-billing";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 25_000;

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  try {
    const { data: snapshot, cacheHit, ageMs } = await withOpenAiAccountCache(
      "admin-openai-account-v1",
      CACHE_TTL_MS,
      () => fetchOpenAiAccountSnapshot(),
    );

    const headers = new Headers();
    headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    headers.set("X-OpenAI-Account-Cache", cacheHit ? "HIT" : "MISS");
    if (snapshot.rateLimited && snapshot.suggestedRetryAfterSec != null) {
      headers.set("Retry-After", String(snapshot.suggestedRetryAfterSec));
    }

    return NextResponse.json(
      {
        ...snapshot,
        serverCache: { hit: cacheHit, ttlMs: CACHE_TTL_MS, ageMs: cacheHit ? ageMs : 0 },
      },
      { headers },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao consultar OpenAI.";
    console.error("[admin/ai/openai-account]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
