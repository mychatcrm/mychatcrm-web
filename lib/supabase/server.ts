/**
 * Supabase client para uso em Server Components, API Routes e Server Actions.
 * Usa a service_role key — nunca exposta ao browser.
 */
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`[supabase/server] env "${name}" não definida.`);
  return v;
}

/**
 * Chaves do Supabase são JWTs. Se `SUPABASE_SERVICE_ROLE_KEY` for a chave **anon**,
 * o PostgREST usa role `anon` e devolve 42501 em tabelas só para service_role.
 */
function assertServiceRoleSupabaseJwt(apiKey: string): void {
  const parts = apiKey.split(".");
  if (parts.length !== 3) return;
  let role: string | undefined;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    role = (JSON.parse(json) as { role?: string }).role;
  } catch {
    return;
  }
  if (!role || role === "service_role") return;
  throw new Error(
    `[supabase/server] SUPABASE_SERVICE_ROLE_KEY tem JWT com role "${role}" (precisa "service_role"). ` +
      "No Supabase: Settings → API → copie o secret **service_role** (não use **anon** / NEXT_PUBLIC_SUPABASE_ANON_KEY). " +
      "O URL tem de ser o mesmo projecto que NEXT_PUBLIC_SUPABASE_URL.",
  );
}

/** Client com privilégio total (bypass RLS) — usar apenas em código servidor. */
export function createSupabaseServiceClient() {
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  assertServiceRoleSupabaseJwt(serviceKey);
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client com a chave pública (anon) — para leituras permitidas via RLS. */
export function createSupabaseAnonClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
