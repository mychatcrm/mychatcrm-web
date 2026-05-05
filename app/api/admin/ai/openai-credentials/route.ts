import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getAdminOpenAiCredentialStatus, invalidateOpenAiApiKeyCache } from "@/lib/ai/openai-api-key";
import { encryptOpenAiKeyForStorage } from "@/lib/server/platform-openai-key-crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isUsableApiSecret } from "@/lib/integrations/server-secrets";

export const dynamic = "force-dynamic";

function platformSecret(): string | null {
  const s = process.env.PLATFORM_OPENAI_KEY_SECRET?.trim();
  return s && s.length >= 8 ? s : null;
}

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

  try {
    const status = await getAdminOpenAiCredentialStatus();
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao ler credenciais.";
    console.error("[admin/ai/openai-credentials] GET", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const secret = platformSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "Defina PLATFORM_OPENAI_KEY_SECRET no servidor (mín. 8 caracteres) para guardar a chave cifrada no Supabase.",
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
      console.error("[admin/ai/openai-credentials] upsert", error.message);
      return NextResponse.json({ error: "Falha ao gravar no Supabase." }, { status: 500 });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Supabase indisponível.";
    console.error("[admin/ai/openai-credentials] PATCH", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  invalidateOpenAiApiKeyCache();
  const status = await getAdminOpenAiCredentialStatus();
  return NextResponse.json({ ok: true, ...status });
}

export async function DELETE() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "ia")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  try {
    const sb = createSupabaseServiceClient();
    const { error } = await sb
      .from("admin_platform_openai")
      .update({ openai_api_key_ciphertext: null, updated_at: new Date().toISOString() })
      .eq("id", "global");
    if (error) {
      console.error("[admin/ai/openai-credentials] DELETE", error.message);
      return NextResponse.json({ error: "Falha ao remover chave." }, { status: 500 });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Supabase indisponível.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  invalidateOpenAiApiKeyCache();
  const status = await getAdminOpenAiCredentialStatus();
  return NextResponse.json({ ok: true, ...status });
}
