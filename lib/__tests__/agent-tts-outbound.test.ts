import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsTtsError } from "@/lib/integrations/elevenlabs";

const textToSpeechElevenLabs = vi.fn();
const evolutionSendAudio = vi.fn();
const uploadMediaToR2 = vi.fn();

vi.mock("@/lib/integrations/elevenlabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/elevenlabs")>();
  return {
    ...actual,
    textToSpeechElevenLabs: (...args: unknown[]) => textToSpeechElevenLabs(...args),
  };
});

vi.mock("@/lib/integrations/evolution-api", () => ({
  evolutionSendAudio: (...args: unknown[]) => evolutionSendAudio(...args),
  resolveEvolutionSendNumber: async ({ number }: { number: string }) => ({
    status: "exists",
    sendNumber: number,
    jid: `${number}@s.whatsapp.net`,
    platformNumber: number,
    candidateNumbers: [number],
  }),
}));

vi.mock("@/lib/integrations/r2-storage", () => ({
  uploadMediaToR2: (...args: unknown[]) => uploadMediaToR2(...args),
}));

import { deliverAgentReplyWithOptionalTts } from "@/lib/server/agent-tts-outbound";

describe("deliverAgentReplyWithOptionalTts", () => {
  beforeEach(() => {
    textToSpeechElevenLabs.mockReset();
    evolutionSendAudio.mockReset();
    uploadMediaToR2.mockReset();
    textToSpeechElevenLabs.mockResolvedValue(Buffer.from("mp3"));
    evolutionSendAudio.mockResolvedValue({ ok: true, status: 200, error: null });
    uploadMediaToR2.mockResolvedValue("key");
  });

  it("does not call ElevenLabs when useTts is false", async () => {
    const sendText = vi.fn(async () => ({ ok: true }));
    const result = await deliverAgentReplyWithOptionalTts({
      instanceName: "inst",
      number: "5511999999999",
      text: "Olá",
      voiceId: "voice_1",
      languageCode: "pt",
      tenantId: "tenant-a",
      useTts: false,
      logScope: "test",
      sendText,
    });

    expect(textToSpeechElevenLabs).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledOnce();
    expect(result.channel).toBe("text");
    expect(result.ttsFallbackToText).toBe(false);
  });

  it("falls back to text on ElevenLabs quota_exceeded", async () => {
    textToSpeechElevenLabs.mockRejectedValue(
      new ElevenLabsTtsError("ElevenLabs TTS 401: quota_exceeded", 401, "quota_exceeded"),
    );
    const sendText = vi.fn(async () => ({ ok: true }));

    const result = await deliverAgentReplyWithOptionalTts({
      instanceName: "inst",
      number: "5511999999999",
      text: "Resposta",
      voiceId: "voice_1",
      languageCode: "pt",
      tenantId: "tenant-a",
      useTts: true,
      logScope: "test",
      sendText,
    });

    expect(sendText).toHaveBeenCalledOnce();
    expect(result.channel).toBe("text");
    expect(result.ttsFallbackToText).toBe(true);
    expect(result.sent).toBe(true);
  });

  it("uses the channel adapter for TTS without calling Evolution", async () => {
    const sendText = vi.fn(async () => ({ ok: true }));
    const sendAudio = vi.fn(async (audio: Buffer) => ({
      ok: audio.equals(Buffer.from("mp3")),
      status: 200,
      data: { messages: [{ id: "wamid.audio" }] },
    }));

    const result = await deliverAgentReplyWithOptionalTts({
      instanceName: "meta-phone-number-id",
      number: "5511999999999",
      text: "Arbitrary multilingual reply",
      voiceId: "voice_1",
      languageCode: "en",
      tenantId: "tenant-a",
      useTts: true,
      logScope: "test-meta",
      sendText,
      sendAudio,
    });

    expect(sendAudio).toHaveBeenCalledOnce();
    expect(evolutionSendAudio).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(result).toMatchObject({ channel: "audio", usedTts: true, sent: true });
  });
});
