import { NextResponse } from "next/server";
import type { IntegrationsRevalidationResponse } from "@/lib/integrations/dashboard-snapshot";
import { evolutionPing, isEvolutionApiConfigured } from "@/lib/integrations/evolution-api";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { loadIntegrationsDashboardSnapshot } from "@/lib/server/integrations-dashboard-snapshot";
import { metaGraphRequest } from "@/lib/server/meta-graph-api";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const preferredRegion = "gru1";

type Provider = "meta" | "evolution";
type RevalidateBody = { providers?: unknown; slots?: unknown };
type Cached = { expiresAt: number; promise: Promise<IntegrationsRevalidationResponse> };

const inFlight = new Map<string, Cached>();
const REMOTE_TIMEOUT_MS = 2_500;
const DEDUPE_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("remote_timeout")), timeoutMs);
    timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function parseProviders(value: unknown): Provider[] {
  if (!Array.isArray(value)) return ["meta", "evolution"];
  const providers = [...new Set(value.filter((item): item is Provider => item === "meta" || item === "evolution"))];
  return providers.length ? providers : ["meta", "evolution"];
}

function parseSlots(value: unknown, totalSlots: number): number[] {
  if (!Array.isArray(value)) return Array.from({ length: totalSlots }, (_item, index) => index);
  return [...new Set(value.map(Number).filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < totalSlots))].sort((a, b) => a - b);
}

async function probeEvolution() {
  if (!isEvolutionApiConfigured()) return { configured: false, reachable: null, error: null };
  try {
    const ping = await withTimeout(evolutionPing(), REMOTE_TIMEOUT_MS);
    return { configured: true, reachable: ping.reachable, error: ping.reachable ? null : ping.error };
  } catch (error) {
    return { configured: true, reachable: null, error: error instanceof Error ? error.message : "remote_timeout" };
  }
}

async function probeMeta(tenantId: string) {
  const { data, error } = await createSupabaseServiceClient()
    .from("meta_connections")
    .select("page_id, page_access_token")
    .eq("tenant_id", tenantId);
  if (error) return { reachable: null, checkedPages: 0, error: "meta_connection_query_failed" };
  const pages = (data ?? []) as Array<{ page_id: string; page_access_token: string }>;
  if (!pages.length) return { reachable: null, checkedPages: 0, error: null };
  try {
    const checks = await withTimeout(
      Promise.all(pages.map(async (page) => {
        await metaGraphRequest(`/${encodeURIComponent(page.page_id)}`, {
          accessToken: page.page_access_token,
          searchParams: { fields: "id" },
        });
        return true;
      })),
      REMOTE_TIMEOUT_MS,
    );
    return { reachable: checks.every(Boolean), checkedPages: checks.length, error: null };
  } catch (probeError) {
    return {
      reachable: null,
      checkedPages: pages.length,
      error: probeError instanceof Error ? probeError.message : "meta_probe_failed",
    };
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = performance.now();
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({})) as RevalidateBody;
  const providers = parseProviders(body.providers);

  try {
    const snapshot = await loadIntegrationsDashboardSnapshot(guard.session);
    const slots = parseSlots(body.slots, snapshot.whatsapp.capacity.totalSlots);
    const cacheKey = `${guard.session.tenantId}:${providers.slice().sort().join(",")}:${slots.join(",")}`;
    const cached = inFlight.get(cacheKey);
    const now = Date.now();
    const promise = cached && cached.expiresAt > now ? cached.promise : (async () => {
      const [evolution, meta] = await Promise.all([
        providers.includes("evolution") ? probeEvolution() : Promise.resolve(null),
        providers.includes("meta") ? probeMeta(guard.session.tenantId) : Promise.resolve(null),
      ]);
      return {
        checkedAt: new Date().toISOString(),
        snapshot,
        evolution,
        meta,
      } satisfies IntegrationsRevalidationResponse;
    })();
    if (!cached || cached.expiresAt <= now) inFlight.set(cacheKey, { expiresAt: now + DEDUPE_MS, promise });
    const result = await promise;
    const durationMs = Math.round(performance.now() - startedAt);
    console.info("[integrations-revalidate] completed", {
      tenant_id: guard.session.tenantId,
      duration_ms: durationMs,
      providers,
      slots,
      evolution_reachable: result.evolution?.reachable ?? null,
      meta_reachable: result.meta?.reachable ?? null,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store", "Server-Timing": `revalidate;dur=${durationMs}` },
    });
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    console.error("[integrations-revalidate] failed", {
      tenant_id: guard.session.tenantId,
      duration_ms: durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Não foi possível atualizar o estado técnico agora." },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Server-Timing": `revalidate;dur=${durationMs}` } },
    );
  }
}
