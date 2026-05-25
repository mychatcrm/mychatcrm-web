import { canUseTts, type InboundKind } from "./tts-gate";

export type AgentResponseMode = "text" | "audio";

export function normalizeAgentResponseMode(value: unknown): AgentResponseMode {
  return value === "audio" ? "audio" : "text";
}

export function normalizeAgentVoiceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function sanitizeAgentResponseSettings(input: {
  responseMode?: unknown;
  voiceId?: unknown;
}): { responseMode: AgentResponseMode; voiceId: string | null } {
  const responseMode = normalizeAgentResponseMode(input.responseMode);
  const voiceId = normalizeAgentVoiceId(input.voiceId);

  if (responseMode !== "audio") {
    return { responseMode: "text", voiceId: null };
  }

  return { responseMode, voiceId };
}

export function validateAgentResponseSettings(input: {
  responseMode?: unknown;
  voiceId?: unknown;
}): string | null {
  const responseMode = normalizeAgentResponseMode(input.responseMode);
  const voiceId = normalizeAgentVoiceId(input.voiceId);

  if (responseMode === "audio" && !voiceId) {
    return "Selecione uma voz do ElevenLabs para ativar respostas em áudio.";
  }

  return null;
}

/** Inbound WhatsApp kinds that count as voice/audio for reply-mode decisions. */
export function isInboundAudioKind(kind: unknown): boolean {
  if (typeof kind !== "string") return false;
  const k = kind.trim().toLowerCase();
  return k === "audio" || k === "voice" || k === "ptt";
}

/** Last message in the burst (chronological) drives text vs audio reply. */
export function resolveLastInboundKind(
  messages: ReadonlyArray<{ kind?: unknown }>,
): "text" | "audio" {
  const last = messages[messages.length - 1];
  if (last && isInboundAudioKind(last.kind)) return "audio";
  return "text";
}

/** @deprecated Prefer {@link canUseTts}. */
export function shouldReplyWithAudio(params: {
  responseMode: AgentResponseMode;
  voiceId: string | null;
  lastInboundKind: InboundKind;
  handoffTriggered?: boolean;
}): boolean {
  return canUseTts({
    agentResponseMode: params.responseMode,
    inboundKind: params.lastInboundKind,
    voiceId: params.voiceId,
    handoffTriggered: params.handoffTriggered,
  });
}

/** DB columns + metadata (legacy toggles) for runtime reply pipeline. */
export function resolveAgentResponseSettingsFromStorage(row: {
  response_mode?: unknown;
  voice_id?: unknown;
  metadata?: unknown;
}): { responseMode: AgentResponseMode; voiceId: string | null } {
  const meta =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  return sanitizeAgentResponseSettings({
    responseMode:
      row.response_mode ??
      meta.responseMode ??
      meta.response_mode ??
      meta.modo_resposta,
    voiceId: row.voice_id ?? meta.voiceId ?? meta.voice_id,
  });
}
