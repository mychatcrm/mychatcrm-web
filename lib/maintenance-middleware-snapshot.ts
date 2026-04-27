import type { NextRequest } from "next/server";

export type MaintenanceSnapshot = {
  enabled: boolean;
  message?: string;
  estimatedReturnAt?: string;
};

/** Estado de manutenção muda raramente; TTL um pouco maior reduz fetches internos no Edge. */
const CACHE_MS = 6000;

let cache: { data: MaintenanceSnapshot; t: number } | null = null;

/**
 * Lê o estado de manutenção via rota interna (Edge-safe: sem fs no middleware).
 * Cache curto para reduzir carga; falha de rede → assume desligado.
 */
export async function fetchMaintenanceSnapshot(request: NextRequest): Promise<MaintenanceSnapshot> {
  const now = Date.now();
  if (cache && now - cache.t < CACHE_MS) return cache.data;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const url = new URL("/api/maintenance/status", request.nextUrl.origin);
    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as {
      enabled?: boolean;
      message?: string;
      estimatedReturnAt?: string;
    };
    const data: MaintenanceSnapshot = {
      enabled: j.enabled === true,
      message: typeof j.message === "string" ? j.message : undefined,
      estimatedReturnAt: typeof j.estimatedReturnAt === "string" ? j.estimatedReturnAt : undefined,
    };
    cache = { data, t: now };
    return data;
  } catch {
    const data: MaintenanceSnapshot = { enabled: false };
    cache = { data, t: now };
    return data;
  }
}

/** Para testes ou invalidação após deploy (opcional). */
export function clearMaintenanceSnapshotCache() {
  cache = null;
}
