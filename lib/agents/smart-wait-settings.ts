export type AgentSmartWaitSettings = {
  enabled: boolean;
  initialSeconds: number;
  followupSeconds: number;
  maxSeconds: number;
  dedupeRepeated: boolean;
};

export const DEFAULT_AGENT_SMART_WAIT: AgentSmartWaitSettings = {
  enabled: true,
  initialSeconds: 7,
  followupSeconds: 10,
  maxSeconds: 60,
  dedupeRepeated: true,
};

export const EVOLUTION_TRANSPORT_QUIET_SECONDS = 65;

export type EvolutionInboundWaitSignal = {
  kind: "text" | "audio" | "image" | "video" | "document";
  text?: string | null;
  hasPendingAgendaAction?: boolean;
  /** Atraso medido desta entrega (received − occurred), em segundos. null = desconhecido. */
  deliveryDelaySeconds?: number | null;
};

export function evolutionInboundNeedsExtendedInitialWait(
  _signal: EvolutionInboundWaitSignal,
): boolean {
  return true;
}

/**
 * A fila QR da Evolution pode entregar fragmentos enviados no mesmo segundo
 * com cerca de 60 s entre webhooks. Mantemos o turno aberto somente nesse
 * transporte; Meta Cloud e os demais canais preservam o Smart Wait curto.
 */
export function evolutionBurstSafeSmartWait(
  settings: AgentSmartWaitSettings,
  _signal?: EvolutionInboundWaitSignal,
): AgentSmartWaitSettings {
  // Pure transport guard. Never inspect content, language, niche or agenda.
  // The Evolution QR queue has delivered bubbles about 60 seconds apart, so
  // every fragment restarts a 65-second quiet window.
  return {
    ...settings,
    enabled: true,
    initialSeconds: Math.max(settings.initialSeconds, EVOLUTION_TRANSPORT_QUIET_SECONDS),
    followupSeconds: Math.max(settings.followupSeconds, EVOLUTION_TRANSPORT_QUIET_SECONDS),
    maxSeconds: Math.max(settings.maxSeconds, EVOLUTION_TRANSPORT_QUIET_SECONDS),
  };
}

function clampSeconds(value: unknown, fallback: number, min = 1, max = 120): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function sanitizeAgentSmartWaitSettings(
  input?: Partial<AgentSmartWaitSettings> | Record<string, unknown> | null,
): AgentSmartWaitSettings {
  const src = input ?? {};
  return {
    // Agrupar mensagens do mesmo burst é uma garantia do pipeline. O campo
    // legado permanece no tipo/metadata para compatibilidade, mas não pode
    // desativar a consistência do turno.
    enabled: true,
    initialSeconds: clampSeconds(src.initialSeconds, DEFAULT_AGENT_SMART_WAIT.initialSeconds, 1, 60),
    followupSeconds: clampSeconds(src.followupSeconds, DEFAULT_AGENT_SMART_WAIT.followupSeconds, 1, 120),
    maxSeconds: clampSeconds(src.maxSeconds, DEFAULT_AGENT_SMART_WAIT.maxSeconds, 5, 180),
    dedupeRepeated: src.dedupeRepeated !== false,
  };
}

export function smartWaitFromMetadata(metadata: Record<string, unknown> | null | undefined): AgentSmartWaitSettings {
  if (!metadata) return { ...DEFAULT_AGENT_SMART_WAIT };
  return sanitizeAgentSmartWaitSettings({
    enabled: metadata.smartWaitEnabled,
    initialSeconds: metadata.smartWaitInitialSeconds,
    followupSeconds: metadata.smartWaitFollowupSeconds,
    maxSeconds: metadata.smartWaitMaxSeconds,
    dedupeRepeated: metadata.smartWaitDedupeRepeated,
  });
}

export function smartWaitToMetadata(settings: AgentSmartWaitSettings): Record<string, unknown> {
  const s = sanitizeAgentSmartWaitSettings(settings);
  return {
    smartWaitEnabled: s.enabled,
    smartWaitInitialSeconds: s.initialSeconds,
    smartWaitFollowupSeconds: s.followupSeconds,
    smartWaitMaxSeconds: s.maxSeconds,
    smartWaitDedupeRepeated: s.dedupeRepeated,
  };
}
