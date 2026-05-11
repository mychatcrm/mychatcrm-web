import { afterEach, describe, expect, it, vi } from "vitest";
import { textToSpeechElevenLabs } from "@/lib/integrations/elevenlabs";

describe("textToSpeechElevenLabs", () => {
  const originalApiKey = process.env.ELEVENLABS_API_KEY;

  afterEach(() => {
    process.env.ELEVENLABS_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it("sends language_code in the ElevenLabs TTS request body", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);

    await textToSpeechElevenLabs("Hola, necesito ayuda", "voice-123", { languageCode: "es" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      text: "Hola, necesito ayuda",
      model_id: "eleven_multilingual_v2",
      language_code: "es",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    });
  });
});
