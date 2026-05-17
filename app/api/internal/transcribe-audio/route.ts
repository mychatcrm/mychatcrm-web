/**
 * POST /api/internal/transcribe-audio
 *
 * Worker interno que recebe os dados de uma mensagem de áudio (rawNode + metadados),
 * chama o Whisper e actualiza whatsapp_messages com o texto transcrito.
 *
 * Chamado em fire-and-forget por triggerAudioTranscription em Phase 1 do webhook.
 * maxDuration = 120 elimina o risco de timeout que existia quando a transcrição
 * era feita directamente no webhook (maxDuration = 60).
 */
import { NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/ai/media-processor";
import type { EvolutionAudioContent } from "@/lib/integrations/evolution-webhook-parse";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AudioTranscriptionTriggerPayload } from "@/lib/server/audio-transcription-trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request)) {
    console.warn("[audio-transcription] auth failed");
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let payload: AudioTranscriptionTriggerPayload;
  try {
    payload = (await request.json()) as AudioTranscriptionTriggerPayload;
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }

  const { dbMessageId, waMessageId, remoteJid, fromMe, instanceName, mimetype, rawNode } = payload;

  if (!dbMessageId || !instanceName) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }

  console.info("[audio-transcription]", {
    event: "transcription_started",
    db_message_id: dbMessageId,
    wa_message_id: waMessageId,
    instance_name: instanceName,
    has_base64: Boolean(rawNode?.base64),
  });

  // Reconstrói EvolutionAudioContent a partir dos dados recebidos.
  // Se rawNode.base64 estiver presente (Evolution com webhookBase64: true),
  // downloadMediaBuffer usará directamente sem chamar a Evolution API.
  const audioContent: EvolutionAudioContent = {
    type: "audio",
    url: "",       // não usado por transcribeAudio (usa rawNode.base64 ou Evolution API)
    mimetype: mimetype || "audio/ogg",
    mediaKey: "", // não usado por transcribeAudio
    rawNode: rawNode ?? {},
  };

  let transcript: string | null = null;
  try {
    transcript = await transcribeAudio(audioContent, instanceName, {
      remoteJid,
      fromMe,
      messageId: waMessageId ?? undefined,
    });
  } catch (err) {
    console.warn(
      "[audio-transcription] transcribeAudio error",
      err instanceof Error ? err.message : err,
    );
  }

  const sb = createSupabaseServiceClient();

  if (transcript) {
    const { error: updateErr } = await sb
      .from("whatsapp_messages")
      .update({ content: transcript, transcription_status: "completed" })
      .eq("id", dbMessageId);

    if (updateErr) {
      console.error(
        "[audio-transcription] db update error",
        updateErr.code,
        updateErr.message,
      );
      return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    console.info("[audio-transcription]", {
      event: "transcription_completed",
      db_message_id: dbMessageId,
      transcript_length: transcript.length,
    });
    return NextResponse.json({ ok: true, transcribed: true });
  }

  // Transcrição falhou — marca como "failed" para não bloquear polling
  await sb
    .from("whatsapp_messages")
    .update({ transcription_status: "failed" })
    .eq("id", dbMessageId);

  console.warn("[audio-transcription]", {
    event: "transcription_failed",
    db_message_id: dbMessageId,
  });
  return NextResponse.json({ ok: true, transcribed: false });
}
