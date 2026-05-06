import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import type { AdminSession } from "@/lib/admin-auth";

export type AdminIaRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number; message: string };

/**
 * Rate limit por admin + rota (memória por instância). Mitiga abuso em rotas sensíveis do hub IA.
 */
export function checkAdminIaRateLimit(
  session: AdminSession,
  routeKey: string,
  maxPerWindow: number,
  windowMs: number,
): AdminIaRateLimitResult {
  const key = `admin-ia:${session.adminId}:${routeKey}`;
  const r = checkInMemoryRateLimit(key, maxPerWindow, windowMs);
  if (r.ok) return { ok: true };
  return {
    ok: false,
    retryAfterSec: r.retryAfterSec,
    message: `Muitas tentativas. Aguarde ${r.retryAfterSec}s e tente novamente.`,
  };
}
