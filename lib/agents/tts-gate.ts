import type { AgentResponseMode } from "./response-settings";
import { isInboundAudioKind } from "./response-settings";

export type InboundKind = "text" | "audio";

/** Evolution / webhook message type → inbound kind for TTS gate. */
export function inboundKindFromEvolutionType(type: string | undefined): InboundKind {
  return type === "audio" ? "audio" : "text";
}

/**
 * Kind of the message that triggered this reply (last id in agent_response_jobs.message_ids).
 * Falls back to last row in the burst when the id is missing.
 */
export function resolveTriggeringInboundKind(
  messages: ReadonlyArray<{ id: string; kind?: unknown }>,
  triggeringMessageId: string | null | undefined,
): InboundKind {
  if (triggeringMessageId) {
    const row = messages.find((m) => m.id === triggeringMessageId);
    if (row) return isInboundAudioKind(row.kind) ? "audio" : "text";
  }
  const last = messages[messages.length - 1];
  if (last && isInboundAudioKind(last.kind)) return "audio";
  return "text";
}

/**
 * Single gate before any ElevenLabs TTS call.
 * Text inbound must never pass (inboundKind === "text" → false).
 */
export function canUseTts(params: {
  agentResponseMode: AgentResponseMode;
  inboundKind: InboundKind;
  voiceId: string | null;
  elevenLabsAvailable?: boolean;
  handoffTriggered?: boolean;
}): boolean {
  if (params.handoffTriggered) return false;
  if (params.inboundKind !== "audio") return false;
  if (params.agentResponseMode !== "audio") return false;
  if (!params.voiceId?.trim()) return false;
  if (params.elevenLabsAvailable === false) return false;
  return true;
}
