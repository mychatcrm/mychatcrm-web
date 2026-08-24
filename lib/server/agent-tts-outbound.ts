import type { SupportedLanguageCode } from "@/lib/ai/language-detect";
import {
  isElevenLabsQuotaOrAuthError,
  textToSpeechElevenLabs,
} from "@/lib/integrations/elevenlabs";
import { evolutionSendAudio, resolveEvolutionSendNumber } from "@/lib/integrations/evolution-api";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";

export type AgentTtsDeliveryResult = {
  channel: "audio" | "text";
  usedTts: boolean;
  ttsFallbackToText: boolean;
  sent: boolean;
  mediaUrl: string | null;
  providerPayload: unknown;
};

export async function deliverAgentReplyWithOptionalTts(params: {
  instanceName: string;
  number: string;
  text: string;
  voiceId: string;
  /** Derivado do texto final; ausente deixa o modelo multilíngue inferir o idioma. */
  languageCode?: SupportedLanguageCode;
  tenantId: string;
  useTts: boolean;
  logScope: string;
  logContext?: Record<string, unknown>;
  sendText: () => Promise<{ ok: boolean; status?: number; error?: string | null; data?: unknown }>;
  /**
   * Adaptador opcional para transportes que não são Evolution (Meta Cloud).
   * Recebe os bytes já gerados; upload e envio ficam no adaptador da conexão.
   */
  sendAudio?: (audio: Buffer) => Promise<{
    ok: boolean;
    status?: number;
    error?: string | null;
    data?: unknown;
  }>;
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
      providerPayload: send.data ?? null,
    };
  }

  try {
    const audioBuffer = await textToSpeechElevenLabs(text, params.voiceId, {
      languageCode: params.languageCode,
    });
    const ttsKey = `whatsapp/${params.tenantId}/tts/${Date.now()}_reply.mp3`;
    const r2Key = await uploadMediaToR2(audioBuffer, ttsKey, "audio/mpeg");
    const mediaUrl = r2Key ? `/api/client/media/${ttsKey}` : null;

    const send = params.sendAudio
      ? await params.sendAudio(audioBuffer)
      : await (async () => {
          const resolvedRecipient = await resolveEvolutionSendNumber({
            instanceName: params.instanceName,
            number: params.number,
          });
          if (resolvedRecipient.status === "not_found") {
            throw new Error("evolution_recipient_not_found");
          }
          const sendNumber =
            resolvedRecipient.status === "exists"
              ? resolvedRecipient.sendNumber
              : params.number;
          return evolutionSendAudio({
            instanceName: params.instanceName,
            number: sendNumber,
            audio: audioBuffer.toString("base64"),
          });
        })();

    if (send.ok) {
      return {
        channel: "audio",
        usedTts: true,
        ttsFallbackToText: false,
        sent: true,
        mediaUrl,
        providerPayload: send.data ?? null,
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
    providerPayload: fallback.data ?? null,
  };
}
