/**
 * Supabase client para uso em Server Components, API Routes e Server Actions.
 * Usa a service_role key — nunca exposta ao browser.
 */
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`[supabase/server] env "${name}" não definida.`);
  return v;
}

/** Client com privilégio total (bypass RLS) — usar apenas em código servidor. */
export function createSupabaseServiceClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
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
