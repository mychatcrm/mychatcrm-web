import { describe, expect, it } from "vitest";
import {
  canUseTts,
  inboundKindFromEvolutionType,
  resolveTriggeringInboundKind,
} from "@/lib/agents/tts-gate";

describe("tts-gate", () => {
  it("inboundKindFromEvolutionType maps only audio as audio", () => {
    expect(inboundKindFromEvolutionType("audio")).toBe("audio");
    expect(inboundKindFromEvolutionType("text")).toBe("text");
    expect(inboundKindFromEvolutionType("image")).toBe("text");
  });

  it("resolveTriggeringInboundKind uses triggering message id", () => {
    const rows = [
      { id: "a1", kind: "audio" },
      { id: "t1", kind: "text" },
    ];
    expect(resolveTriggeringInboundKind(rows, "t1")).toBe("text");
    expect(resolveTriggeringInboundKind(rows, "a1")).toBe("audio");
  });

  it("canUseTts blocks text inbound even in audio agent mode", () => {
    expect(
      canUseTts({
        agentResponseMode: "audio",
        inboundKind: "text",
        voiceId: "voice_1",
        elevenLabsAvailable: true,
      }),
    ).toBe(false);
  });

  it("canUseTts allows audio inbound only in audio mode with voice", () => {
    expect(
      canUseTts({
        agentResponseMode: "audio",
        inboundKind: "audio",
        voiceId: "voice_1",
        elevenLabsAvailable: true,
      }),
    ).toBe(true);
  });

  it("canUseTts blocks when ElevenLabs is not available", () => {
    expect(
      canUseTts({
        agentResponseMode: "audio",
        inboundKind: "audio",
        voiceId: "voice_1",
        elevenLabsAvailable: false,
      }),
    ).toBe(false);
  });
});
