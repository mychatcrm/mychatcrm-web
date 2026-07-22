export const EVOLUTION_INBOUND_DELAY_WARNING_MS = 30_000;

export type EvolutionInboundLatency = {
  milliseconds: number;
  seconds: number;
  delayed: boolean;
};

export function measureEvolutionInboundLatency(
  occurredAt: string | null | undefined,
  receivedAt: string,
): EvolutionInboundLatency | null {
  if (!occurredAt) return null;
  const occurredMs = Date.parse(occurredAt);
  const receivedMs = Date.parse(receivedAt);
  if (!Number.isFinite(occurredMs) || !Number.isFinite(receivedMs)) return null;
  const milliseconds = Math.max(0, receivedMs - occurredMs);
  return {
    milliseconds,
    seconds: Math.round((milliseconds / 1_000) * 100) / 100,
    delayed: milliseconds > EVOLUTION_INBOUND_DELAY_WARNING_MS,
  };
}
