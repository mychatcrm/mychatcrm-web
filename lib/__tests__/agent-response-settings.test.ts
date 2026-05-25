import { describe, expect, it } from "vitest";
import {
  normalizeAgentResponseMode,
  normalizeAgentVoiceId,
  resolveAgentResponseSettingsFromStorage,
  sanitizeAgentResponseSettings,
  validateAgentResponseSettings,
} from "@/lib/agents";

describe("agent response settings", () => {
  it("normalizes invalid mode to text", () => {
    expect(normalizeAgentResponseMode("whatever")).toBe("text");
    expect(normalizeAgentResponseMode("audio")).toBe("audio");
  });

  it("trims voice id and drops empty values", () => {
    expect(normalizeAgentVoiceId("  voice_123  ")).toBe("voice_123");
    expect(normalizeAgentVoiceId("   ")).toBeNull();
  });

  it("clears voice id when response mode is text", () => {
    expect(
      sanitizeAgentResponseSettings({
        responseMode: "text",
        voiceId: "voice_123",
      }),
    ).toEqual({
      responseMode: "text",
      voiceId: null,
    });
  });

  it("keeps audio mode with selected voice", () => {
    expect(
      sanitizeAgentResponseSettings({
        responseMode: "audio",
        voiceId: " voice_123 ",
      }),
    ).toEqual({
      responseMode: "audio",
      voiceId: "voice_123",
    });
  });

  it("requires voice selection when audio mode is enabled", () => {
    expect(
      validateAgentResponseSettings({
        responseMode: "audio",
        voiceId: "",
      }),
    ).toBe("Selecione uma voz do ElevenLabs para ativar respostas em áudio.");
  });

  it("reads modo_resposta from metadata when DB column is unset", () => {
    expect(
      resolveAgentResponseSettingsFromStorage({
        metadata: { modo_resposta: "audio", voiceId: "v1" },
      }),
    ).toEqual({ responseMode: "audio", voiceId: "v1" });
  });
});
