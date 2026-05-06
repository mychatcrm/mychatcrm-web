/**
 * Supabase client para uso em Server Components, API Routes e Server Actions.
 * Usa `SUPABASE_SERVICE_ROLE_KEY` — nunca exposta ao browser.
 */
import { createClient } from "@supabase/supabase-js";
import {
  assertSupabaseAnonPublicKeyForBrowser,
  assertSupabaseBackendSecretKeyForServiceClient,
  assertSupabaseKeysNotSwapped,
  assertSupabaseProjectUrl,
} from "@/lib/server/supabase-backend-secret";

function getEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`[supabase/server] env "${name}" não definida.`);
  return v;
}

/** Client com privilégio total (bypass RLS) — usar apenas em código servidor. */
export function createSupabaseServiceClient() {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  assertSupabaseProjectUrl(url);
  assertSupabaseKeysNotSwapped();
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  assertSupabaseBackendSecretKeyForServiceClient(serviceKey);
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client com a chave pública (anon) — para leituras permitidas via RLS. */
export function createSupabaseAnonClient() {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  assertSupabaseProjectUrl(url);
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  assertSupabaseAnonPublicKeyForBrowser(anon);
  assertSupabaseKeysNotSwapped();
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
