import { decryptOpenAiKeyFromStorage } from "@/lib/server/platform-openai-key-crypto";
import { getPlatformOpenAiEncryptionSecret } from "@/lib/server/platform-openai-encryption-secret";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUsableApiSecret } from "@/lib/integrations/server-secrets";

const CACHE_TTL_MS = 90_000;

type CacheEntry = { value: string | null; expiresAt: number };

function getGlobalCache(): CacheEntry | undefined {
  return (globalThis as unknown as { __openAiApiKeyCache?: CacheEntry }).__openAiApiKeyCache;
}

function setGlobalCache(entry: CacheEntry | undefined): void {
  (globalThis as unknown as { __openAiApiKeyCache?: CacheEntry }).__openAiApiKeyCache = entry;
}

export function invalidateOpenAiApiKeyCache(): void {
  setGlobalCache(undefined);
}

/** Chave só a partir de `OPENAI_API_KEY` (síncrono). */
export function peekOpenAiApiKeyFromEnv(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (!isUsableApiSecret(raw)) return null;
  return raw!.trim();
}

function platformSecret(): string | null {
  return getPlatformOpenAiEncryptionSecret();
}

async function loadDecryptedKeyFromDatabase(): Promise<string | null> {
  const secret = platformSecret();
  if (!secret) return null;

  let sb: ReturnType<typeof createSupabaseAdminClient>;
  try {
    sb = createSupabaseAdminClient();
  } catch {
    return null;
  }

  const { data, error } = await sb
    .from("admin_platform_openai")
    .select("openai_api_key_ciphertext")
    .eq("id", "global")
    .maybeSingle();

  if (error || !data) return null;
  const ct = data.openai_api_key_ciphertext;
  if (typeof ct !== "string" || !ct.trim()) return null;

  const plain = decryptOpenAiKeyFromStorage(ct.trim(), secret);
  if (!plain || !isUsableApiSecret(plain)) return null;
  return plain.trim();
}

/**
 * Chave efetiva para chamadas OpenAI: `OPENAI_API_KEY` no ambiente tem prioridade;
 * senão, chave cifrada em `admin_platform_openai` (requer `PLATFORM_OPENAI_KEY_SECRET`).
 */
export async function resolveOpenAiApiKey(): Promise<string | null> {
  const envKey = peekOpenAiApiKeyFromEnv();
  if (envKey) return envKey;

  const now = Date.now();
  const cached = getGlobalCache();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const fromDb = await loadDecryptedKeyFromDatabase();
  setGlobalCache({ value: fromDb, expiresAt: now + CACHE_TTL_MS });
  return fromDb;
}

export type OpenAiKeyEffectiveSource = "env" | "database" | "none";

function maskSuffix(key: string): string {
  const t = key.trim();
  if (t.length <= 4) return "****";
  return `…${t.slice(-4)}`;
}

export type AdminOpenAiCredentialStatus = {
  envConfigured: boolean;
  databaseConfigured: boolean;
  effectiveSource: OpenAiKeyEffectiveSource;
  maskedSuffix: string | null;
};

/** Para GET admin: nunca expõe a chave completa. */
export async function getAdminOpenAiCredentialStatus(): Promise<AdminOpenAiCredentialStatus> {
  const envKey = peekOpenAiApiKeyFromEnv();
  let databaseConfigured = false;

  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb
      .from("admin_platform_openai")
      .select("openai_api_key_ciphertext")
      .eq("id", "global")
      .maybeSingle();
    const ct = data?.openai_api_key_ciphertext;
    databaseConfigured = typeof ct === "string" && ct.trim().length > 0;
  } catch {
    databaseConfigured = false;
  }

  if (envKey) {
    return {
      envConfigured: true,
      databaseConfigured,
      effectiveSource: "env",
      maskedSuffix: maskSuffix(envKey),
    };
  }

  const dbKey = await resolveOpenAiApiKey();
  if (dbKey) {
    return {
      envConfigured: false,
      databaseConfigured: true,
      effectiveSource: "database",
      maskedSuffix: maskSuffix(dbKey),
    };
  }

  return {
    envConfigured: false,
    databaseConfigured,
    effectiveSource: "none",
    maskedSuffix: null,
  };
}
