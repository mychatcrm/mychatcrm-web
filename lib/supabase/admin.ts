/**
 * Cliente Supabase para operações administrativas da plataforma (IA, métricas internas, etc.).
 *
 * - Só importar em Route Handlers, Server Actions ou módulos `lib/server/*`.
 * - `server-only` impede bundling acidental no browser.
 * - Usa `SUPABASE_SERVICE_ROLE_KEY` com validação de JWT em `server.ts`.
 */
import "server-only";

export { createSupabaseServiceClient as createSupabaseAdminClient } from "./server";
