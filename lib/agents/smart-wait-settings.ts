export type AgentSmartWaitSettings = {
  enabled: boolean;
  initialSeconds: number;
  followupSeconds: number;
  maxSeconds: number;
  dedupeRepeated: boolean;
};

export const DEFAULT_AGENT_SMART_WAIT: AgentSmartWaitSettings = {
  enabled: true,
  initialSeconds: 5,
  followupSeconds: 10,
  maxSeconds: 30,
  dedupeRepeated: true,
};

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
    enabled: src.enabled !== false,
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
