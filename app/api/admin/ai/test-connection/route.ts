import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { checkAdminIaRateLimit } from "@/lib/admin-ai-rate-limit";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";
import { logAdminIaAudit } from "@/lib/server/admin-ia-audit";
import type { OpenAiTestConnectionPayload } from "@/lib/ai/admin-ia-hub-types";

export const dynamic = "force-dynamic";

export type { OpenAiTestConnectionPayload };

export async function POST() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const rl = checkAdminIaRateLimit(session, "test-connection", 12, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "RATE_LIMIT_ADMIN", latencyMs: null, httpStatus: 429, message: rl.message } satisfies OpenAiTestConnectionPayload,
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const key = await resolveOpenAiApiKey();
  if (!key) {
    const body: OpenAiTestConnectionPayload = {
      ok: false,
      code: "NO_KEY",
      latencyMs: null,
      httpStatus: null,
      message: "Nenhuma chave OpenAI resolvida (env ou painel).",
    };
    void logAdminIaAudit({
      adminId: session.adminId,
      action: "openai_test_connection",
      detail: { ok: false, code: "NO_KEY" },
    });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }

  const t0 = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/models?limit=1", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    const latencyMs = Date.now() - t0;
    const ok = res.ok;
    const code: OpenAiTestConnectionPayload["code"] = ok ? "OK" : "HTTP_ERROR";
    const body: OpenAiTestConnectionPayload = {
      ok,
      code,
      latencyMs,
      httpStatus: res.status,
      message: ok
        ? `OpenAI respondeu em ${latencyMs}ms (probe /v1/models).`
        : `OpenAI devolveu HTTP ${res.status}.`,
    };
    void logAdminIaAudit({
      adminId: session.adminId,
      action: "openai_test_connection",
      detail: { ok, httpStatus: res.status, latencyMs },
    });
    return NextResponse.json(body, { status: ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro de rede";
    const body: OpenAiTestConnectionPayload = {
      ok: false,
      code: "NETWORK",
      latencyMs: null,
      httpStatus: null,
      message: msg,
    };
    void logAdminIaAudit({
      adminId: session.adminId,
      action: "openai_test_connection",
      detail: { ok: false, code: "NETWORK" },
    });
    return NextResponse.json(body, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
