/**
 * Inspecção da configuração do backend Supabase **sem** criar cliente nem logar segredos.
 * Usado pelo diagnóstico admin (`/api/admin/ai/infrastructure-health`).
 *
 * `opaque_secret` (prefixo `sb_secret_*`) é formato administrativo válido em paralelo ao JWT legacy `service_role`.
 */
import { Buffer } from "node:buffer";

export type BackendSupabaseCredentialTier =
  | "service_role"
  | "opaque_secret"
  | "non_service_role"
  | "missing"
  | "non_jwt";

export function classifyBackendSupabaseCredential(): BackendSupabaseCredentialTier {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!k) return "missing";
  if (k.startsWith("sb_secret_")) return "opaque_secret";
  const parts = k.split(".");
  if (parts.length !== 3) return "non_jwt";
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    const role = (JSON.parse(json) as { role?: string }).role;
    if (role === "service_role") return "service_role";
    return "non_service_role";
  } catch {
    return "non_jwt";
  }
}
