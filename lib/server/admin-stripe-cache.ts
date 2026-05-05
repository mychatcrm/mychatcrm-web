const DEFAULT_TTL_MS = 25_000;

type Entry = { expiry: number; payload: unknown };
const cache = new Map<string, Entry>();

/** Cache em memória (por instância serverless curta — reduz rajadas ao Stripe durante polling). */
export async function withAdminStripeCache<T>(key: string, ttlMs = DEFAULT_TTL_MS, factory: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiry > now) return hit.payload as T;

  const payload = await factory();
  cache.set(key, { expiry: now + ttlMs, payload });
  return payload;
}
