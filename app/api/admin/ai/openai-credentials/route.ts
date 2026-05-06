import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { checkAdminIaRateLimit } from "@/lib/admin-ai-rate-limit";
import { getAdminOpenAiCredentialStatus, invalidateOpenAiApiKeyCache } from "@/lib/ai/openai-api-key";
import { logAdminIaAudit } from "@/lib/server/admin-ia-audit";
import { encryptOpenAiKeyForStorage } from "@/lib/server/platform-openai-key-crypto";
import { getPlatformOpenAiEncryptionSecret } from "@/lib/server/platform-openai-encryption-secret";
import { logAdminIaDataPlaneIssue, surfacePostgrestForAdminUi } from "@/lib/server/admin-ia-data-plane-errors";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isUsableApiSecret } from "@/lib/integrations/server-secrets";

export const dynamic = "force-dynamic";

function isValidOpenAiKeyFormat(key: string): boolean {
  const t = key.trim();
  if (t.length < 20) return false;
  return t.startsWith("sk-");
}

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const rl = checkAdminIaRateLimit(session, "openai-credentials-get", 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  try {
    const status = await getAdminOpenAiCredentialStatus();
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : "Erro ao ler credenciais.";
    logAdminIaDataPlaneIssue("openai-credentials GET catch", { message: raw, code: null });
    const surf = surfacePostgrestForAdminUi(raw, null);
    return NextResponse.json({ error: surf.headline, hint: surf.guidance }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const rl = checkAdminIaRateLimit(session, "openai-credentials-patch", 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const secret = getPlatformOpenAiEncryptionSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "Defina PLATFORM_OPENAI_KEY_SECRET ou CLIENT_SESSION_COOKIE_SECRET no servidor (mín. 8 caracteres) para cifrar a chave no Supabase.",
      },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const raw = body.openaiApiKey;
  if (typeof raw !== "string" || !isUsableApiSecret(raw)) {
    return NextResponse.json({ error: "openaiApiKey inválida ou vazia." }, { status: 400 });
  }
  const openaiApiKey = raw.trim();
  if (!isValidOpenAiKeyFormat(openaiApiKey)) {
    return NextResponse.json(
      { error: "Formato de chave inválido. Esperada chave OpenAI (prefixo sk-)." },
      { status: 400 },
    );
  }

  let ciphertext: string;
  try {
    ciphertext = encryptOpenAiKeyForStorage(openaiApiKey, secret);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Falha ao cifrar.";
    console.error("[admin/ai/openai-credentials] encrypt", msg);
    return NextResponse.json({ error: "Falha ao cifrar a chave." }, { status: 500 });
  }

  try {
    const sb = createSupabaseServiceClient();
    const { error } = await sb.from("admin_platform_openai").upsert(
      {
        id: "global",
        openai_api_key_ciphertext: ciphertext,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) {
      logAdminIaDataPlaneIssue("openai-credentials upsert", { message: error.message, code: error.code });
      const surf = surfacePostgrestForAdminUi(error.message, error.code ?? null);
      return NextResponse.json(
        { error: "Não foi possível gravar a chave no armazenamento da plataforma.", hint: surf.guidance ?? surf.headline },
        { status: 500 },
      );
    }
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : "Supabase indisponível.";
    logAdminIaDataPlaneIssue("openai-credentials PATCH catch", { message: raw, code: null });
    const surf = surfacePostgrestForAdminUi(raw, null);
    return NextResponse.json({ error: surf.headline, hint: surf.guidance }, { status: 500 });
  }

  invalidateOpenAiApiKeyCache();
  const status = await getAdminOpenAiCredentialStatus();
  void logAdminIaAudit({
    adminId: session.adminId,
    action: "openai_credentials_patch",
    detail: { effectiveSource: status.effectiveSource, databaseConfigured: status.databaseConfigured },
  });
  return NextResponse.json({ ok: true, ...status });
}

export async function DELETE() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const rl = checkAdminIaRateLimit(session, "openai-credentials-delete", 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  try {
    const sb = createSupabaseServiceClient();
    const { error } = await sb
      .from("admin_platform_openai")
      .update({ openai_api_key_ciphertext: null, updated_at: new Date().toISOString() })
      .eq("id", "global");
    if (error) {
      logAdminIaDataPlaneIssue("openai-credentials DELETE", { message: error.message, code: error.code });
      const surf = surfacePostgrestForAdminUi(error.message, error.code ?? null);
      return NextResponse.json(
        { error: "Não foi possível remover a chave do armazenamento da plataforma.", hint: surf.guidance ?? surf.headline },
        { status: 500 },
      );
    }
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : "Supabase indisponível.";
    logAdminIaDataPlaneIssue("openai-credentials DELETE catch", { message: raw, code: null });
    const surf = surfacePostgrestForAdminUi(raw, null);
    return NextResponse.json({ error: surf.headline, hint: surf.guidance }, { status: 500 });
  }

  invalidateOpenAiApiKeyCache();
  const status = await getAdminOpenAiCredentialStatus();
  void logAdminIaAudit({
    adminId: session.adminId,
    action: "openai_credentials_delete",
    detail: { effectiveSource: status.effectiveSource, databaseConfigured: status.databaseConfigured },
  });
  return NextResponse.json({ ok: true, ...status });
}
