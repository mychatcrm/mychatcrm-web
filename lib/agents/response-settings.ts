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
