/**
 * audio-transcription-trigger.ts
 *
 * Fire-and-forget helper que enfileira a transcrição de áudio em um endpoint
 * interno separado (maxDuration = 120), evitando estourar o limite de 60s do
 * webhook Evolution.
 *
 * Padrão idêntico ao triggerAgentResponseJobProcessor em agent-response-jobs.ts.
 */
import { getInternalApiToken, internalApiAuthHeaders } from "@/lib/server/internal-api-auth";

export type AudioTranscriptionTriggerPayload = {
  /** UUID da linha em whatsapp_messages a ser actualizada após transcrição. */
  dbMessageId: string;
  /** ID da mensagem WhatsApp (para Evolution API /chat/getBase64FromMediaMessage). */
  waMessageId: string | null;
  remoteJid: string;
  fromMe: boolean;
  instanceName: string;
  mimetype: string;
  /**
   * rawNode completo da mensagem Evolution (inclui base64 se webhookBase64=true).
   * Passado aqui para evitar uma segunda chamada à Evolution API no worker.
   */
  rawNode: Record<string, unknown>;
};

function getAppBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://mychatcrm.vercel.app"
  );
}

/**
 * Dispara a transcrição de áudio em background (fire-and-forget).
 * Retorna true se o fetch foi iniciado; false se INTERNAL_API_TOKEN não estiver configurado.
 * Nunca lança excepção.
 */
export function triggerAudioTranscription(payload: AudioTranscriptionTriggerPayload): boolean {
  const secret = getInternalApiToken();
  if (!secret) {
    console.warn(
      "[audio-transcription] INTERNAL_API_TOKEN não configurado — transcrição pulada",
    );
    return false;
  }

  const url = new URL("/api/internal/transcribe-audio", getAppBase());

  void fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalApiAuthHeaders(),
    },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn(
      "[audio-transcription] trigger fetch falhou",
      err instanceof Error ? err.message : err,
    );
  });

  return true;
}
