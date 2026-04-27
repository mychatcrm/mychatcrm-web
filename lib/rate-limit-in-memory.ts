type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

/**
 * Limite simples em memória (por instância). Adequado a login; em escala usar Redis/edge.
 */
export function checkInMemoryRateLimit(
  key: string,
  max: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now - cur.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true };
  }
  if (cur.count >= max) {
    const retryAfterMs = windowMs - (now - cur.windowStart);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  cur.count += 1;
  buckets.set(key, cur);
  return { ok: true };
}
