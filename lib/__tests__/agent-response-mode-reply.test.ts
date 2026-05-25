import { describe, expect, it } from "vitest";
import {
  canUseTts,
  isInboundAudioKind,
  resolveAgentResponseSettingsFromStorage,
  resolveLastInboundKind,
  resolveTriggeringInboundKind,
  shouldReplyWithAudio,
} from "@/lib/agents";

describe("agent response mode reply", () => {
  it("detects inbound audio kinds including voice and ptt", () => {
    expect(isInboundAudioKind("audio")).toBe(true);
    expect(isInboundAudioKind("voice")).toBe(true);
    expect(isInboundAudioKind("ptt")).toBe(true);
    expect(isInboundAudioKind("text")).toBe(false);
    expect(isInboundAudioKind("image")).toBe(false);
  });

  it("uses last message in burst for inbound kind", () => {
    expect(
      resolveLastInboundKind([
        { kind: "audio" },
        { kind: "text" },
      ]),
    ).toBe("text");
    expect(
      resolveLastInboundKind([
        { kind: "text" },
        { kind: "audio" },
      ]),
    ).toBe("audio");
  });

  it("text inbound never triggers audio reply", () => {
    expect(
      shouldReplyWithAudio({
        responseMode: "audio",
        voiceId: "voice_1",
        lastInboundKind: "text",
      }),
    ).toBe(false);
  });

  it("audio inbound with text mode replies in text", () => {
    expect(
      shouldReplyWithAudio({
        responseMode: "text",
        voiceId: null,
        lastInboundKind: "audio",
      }),
    ).toBe(false);
  });

  it("audio inbound with audio mode and voice uses TTS path", () => {
    expect(
      canUseTts({
        agentResponseMode: "audio",
        inboundKind: "audio",
        voiceId: "voice_1",
        elevenLabsAvailable: true,
      }),
    ).toBe(true);
  });

  it("text trigger message blocks TTS even if burst had earlier audio", () => {
    const rows = [
      { id: "audio-1", kind: "audio" },
      { id: "text-2", kind: "text" },
    ];
    expect(resolveTriggeringInboundKind(rows, "text-2")).toBe("text");
    expect(
      canUseTts({
        agentResponseMode: "audio",
        inboundKind: resolveTriggeringInboundKind(rows, "text-2"),
        voiceId: "voice_1",
        elevenLabsAvailable: true,
      }),
    ).toBe(false);
  });

  it("audio mode without voice id does not use TTS", () => {
    expect(
      shouldReplyWithAudio({
        responseMode: "audio",
        voiceId: null,
        lastInboundKind: "audio",
      }),
    ).toBe(false);
  });

  it("handoff suppresses audio reply even in audio mode", () => {
    expect(
      shouldReplyWithAudio({
        responseMode: "audio",
        voiceId: "voice_1",
        lastInboundKind: "audio",
        handoffTriggered: true,
      }),
    ).toBe(false);
  });

  it("falls back to metadata when response_mode column is empty", () => {
    expect(
      resolveAgentResponseSettingsFromStorage({
        response_mode: null,
        voice_id: null,
        metadata: { responseMode: "audio", voiceId: " voice_meta " },
      }),
    ).toEqual({
      responseMode: "audio",
      voiceId: "voice_meta",
    });
  });
});
