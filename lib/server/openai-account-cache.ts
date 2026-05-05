const DEFAULT_TTL_MS = 25_000;

type Entry<T> = { expiry: number; storedAt: number; payload: T };
const cache = new Map<string, Entry<unknown>>();

export type OpenAiCacheResult<T> = {
  data: T;
  cacheHit: boolean;
  /** Tempo desde gravação no cache (0 em miss). */
  ageMs: number;
};

/** Cache em memória curto para billing OpenAI (reduz 429 durante polling admin). */
export async function withOpenAiAccountCache<T>(
  key: string,
  ttlMs = DEFAULT_TTL_MS,
  factory: () => Promise<T>,
): Promise<OpenAiCacheResult<T>> {
  const now = Date.now();
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && hit.expiry > now) {
    return { data: hit.payload, cacheHit: true, ageMs: now - hit.storedAt };
  }

  const payload = await factory();
  cache.set(key, { expiry: now + ttlMs, storedAt: now, payload });
  return { data: payload, cacheHit: false, ageMs: 0 };
}
