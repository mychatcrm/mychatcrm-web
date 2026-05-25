import type { SupportedLanguageCode } from "@/lib/ai/language-detect";
import {
  isElevenLabsQuotaOrAuthError,
  textToSpeechElevenLabs,
} from "@/lib/integrations/elevenlabs";
import { evolutionSendAudio } from "@/lib/integrations/evolution-api";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";

export type AgentTtsDeliveryResult = {
  channel: "audio" | "text";
  usedTts: boolean;
  ttsFallbackToText: boolean;
  sent: boolean;
  mediaUrl: string | null;
};

export async function deliverAgentReplyWithOptionalTts(params: {
  instanceName: string;
  number: string;
  text: string;
  voiceId: string;
  languageCode: SupportedLanguageCode;
  tenantId: string;
  useTts: boolean;
  logScope: string;
  logContext?: Record<string, unknown>;
  sendText: () => Promise<{ ok: boolean; status?: number; error?: string | null }>;
}): Promise<AgentTtsDeliveryResult> {
  const text = params.text.slice(0, 4000);
  if (!params.useTts) {
    const send = await params.sendText();
    if (!send.ok) {
      console.error(`[${params.logScope}] sendText`, send.status, send.error, params.logContext);
    }
    return {
      channel: "text",
      usedTts: false,
      ttsFallbackToText: false,
      sent: send.ok,
      mediaUrl: null,
    };
  }

  try {
    const audioBuffer = await textToSpeechElevenLabs(text, params.voiceId, {
      languageCode: params.languageCode,
    });
    const ttsKey = `whatsapp/${params.tenantId}/tts/${Date.now()}_reply.mp3`;
    const r2Key = await uploadMediaToR2(audioBuffer, ttsKey, "audio/mpeg");
    const mediaUrl = r2Key ? `/api/client/media/${ttsKey}` : null;

    const send = await evolutionSendAudio({
      instanceName: params.instanceName,
      number: params.number,
      audio: audioBuffer.toString("base64"),
    });

    if (send.ok) {
      return {
        channel: "audio",
        usedTts: true,
        ttsFallbackToText: false,
        sent: true,
        mediaUrl,
      };
    }

    console.warn(`[${params.logScope}]`, {
      event: "tts_send_audio_failed_fallback_text",
      status: send.status,
      error: send.error,
      ...params.logContext,
    });
  } catch (err) {
    const quotaOrAuth = isElevenLabsQuotaOrAuthError(err);
    console.warn(`[${params.logScope}]`, {
      event: "tts_failed_fallback_text",
      quota_or_auth: quotaOrAuth,
      message: err instanceof Error ? err.message : String(err),
      ...params.logContext,
    });
  }

  const fallback = await params.sendText();
  if (!fallback.ok) {
    console.error(`[${params.logScope}] sendText after TTS fallback`, fallback.status, fallback.error, params.logContext);
  }
  return {
    channel: "text",
    usedTts: false,
    ttsFallbackToText: true,
    sent: fallback.ok,
    mediaUrl: null,
  };
}
