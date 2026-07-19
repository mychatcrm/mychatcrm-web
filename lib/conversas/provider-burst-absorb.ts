/**
 * Absorção de burst pelo relógio do WhatsApp (`created_at`), não pelo
 * `received_at` do webhook. A Evolution pode entregar fragmentos do mesmo
 * segundo com ~60s entre webhooks; o turno precisa juntar o que o lead já
 * digitou mesmo que o app só veja a 2ª mensagem depois.
 */

/** Janela à frente do âncora (provider created_at) para absorver complementos. */
export const PROVIDER_BURST_FORWARD_MS = 90_000;
/** Folga para trás (clock skew / ordenação). */
export const PROVIDER_BURST_LOOKBACK_MS = 2_000;
/** Pausa curta no processador antes do LLM para pegar inserts atrasados. */
export const PROVIDER_BURST_LAST_LOOK_MS = 1_500;

export type ProviderTimedRow = {
  id: string;
  created_at: string;
};

export function parseProviderTimeMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function resolveProviderBurstAnchorMs(params: {
  providerFirstMessageAt?: string | null;
  inboundRows: ProviderTimedRow[];
}): number | null {
  const fromJob = parseProviderTimeMs(params.providerFirstMessageAt ?? null);
  if (fromJob != null) return fromJob;
  let earliest: number | null = null;
  for (const row of params.inboundRows) {
    const t = parseProviderTimeMs(row.created_at);
    if (t == null) continue;
    if (earliest == null || t < earliest) earliest = t;
  }
  return earliest;
}

export function isWithinProviderBurstWindow(
  anchorMs: number,
  candidateCreatedAt: string,
): boolean {
  const t = parseProviderTimeMs(candidateCreatedAt);
  if (t == null) return false;
  return (
    t >= anchorMs - PROVIDER_BURST_LOOKBACK_MS &&
    t <= anchorMs + PROVIDER_BURST_FORWARD_MS
  );
}

/**
 * Mescla candidatos do burst provider no conjunto do job (dedupe por id),
 * ordenando por created_at (hora WA) e depois received_at se existir.
 */
export function mergeProviderBurstRows<T extends ProviderTimedRow & { received_at?: string }>(
  existing: readonly T[],
  candidates: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const row of existing) byId.set(row.id, row);
  for (const row of candidates) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ac = parseProviderTimeMs(a.created_at) ?? 0;
    const bc = parseProviderTimeMs(b.created_at) ?? 0;
    if (ac !== bc) return ac - bc;
    const ar = parseProviderTimeMs(a.received_at ?? null) ?? 0;
    const br = parseProviderTimeMs(b.received_at ?? null) ?? 0;
    return ar - br;
  });
}

/**
 * Após o agente já ter respondido, a msg2 do mesmo burst (tempo WA) ainda
 * deve virar continuidade — não cumprimento solto engolido.
 */
export function isProviderBurstContinuation(params: {
  inboundCreatedAt: string;
  lastAgentResponseAt: string | null | undefined;
  burstAnchorCreatedAt: string | null | undefined;
}): boolean {
  const inboundMs = parseProviderTimeMs(params.inboundCreatedAt);
  const anchorMs = parseProviderTimeMs(params.burstAnchorCreatedAt ?? null);
  if (inboundMs == null || anchorMs == null) return false;
  if (!isWithinProviderBurstWindow(anchorMs, params.inboundCreatedAt)) return false;
  const agentMs = parseProviderTimeMs(params.lastAgentResponseAt ?? null);
  if (agentMs == null) return true;
  // Continuação: lead digitou no burst; agente já falou no meio.
  return inboundMs <= agentMs + PROVIDER_BURST_FORWARD_MS;
}
