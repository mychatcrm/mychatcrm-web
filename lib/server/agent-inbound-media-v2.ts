import "server-only";

import { describeImageFromBuffer, transcribeAudioFromBuffer } from "@/lib/ai/media-processor";
import { getMediaBufferFromR2 } from "@/lib/integrations/r2-storage";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type EnrichableAgentInboundMediaV2 = {
  id: string;
  content: string;
  kind: string;
  storage_key: string | null;
  mime_type: string | null;
  analysis_status: string | null;
  ai_description: string | null;
};

/** Processamento técnico comum de mídia recebida, sem decisão de negócio/canal. */
export async function enrichAgentInboundMediaV2(
  sb: SupabaseServiceClient,
  rows: EnrichableAgentInboundMediaV2[],
): Promise<void> {
  for (const row of rows) {
    if (row.kind === "audio" && row.content === "[Áudio]") {
      if (!row.storage_key) {
        row.content = "[Audio transcription unavailable]";
        continue;
      }
      try {
        const transcript = await transcribeAudioFromBuffer(
          await getMediaBufferFromR2(row.storage_key),
          row.mime_type || "audio/ogg",
        );
        if (transcript) {
          row.content = transcript;
          await sb
            .from("whatsapp_messages")
            .update({ content: transcript, transcription_status: "completed" })
            .eq("id", row.id);
        } else {
          row.content = "[Audio transcription unavailable]";
          await sb
            .from("whatsapp_messages")
            .update({ transcription_status: "failed" })
            .eq("id", row.id);
        }
      } catch {
        row.content = "[Audio transcription unavailable]";
        await sb
          .from("whatsapp_messages")
          .update({ transcription_status: "failed" })
          .eq("id", row.id);
      }
      continue;
    }

    if (row.kind !== "image") continue;
    let description =
      row.analysis_status === "completed" ? row.ai_description?.trim() || null : null;
    if (!description && row.storage_key) {
      try {
        description = await describeImageFromBuffer(
          await getMediaBufferFromR2(row.storage_key),
          row.mime_type || "image/jpeg",
        );
      } catch {
        description = null;
      }
    }
    if (description) {
      await sb
        .from("whatsapp_messages")
        .update({ analysis_status: "completed", ai_description: description })
        .eq("id", row.id);
      const caption = row.content.replace(/^\s*\[(?:imagem|image)\]\s*$/i, "").trim();
      row.content = [caption, "[Visual analysis]", description].filter(Boolean).join("\n");
    } else {
      await sb.from("whatsapp_messages").update({ analysis_status: "failed" }).eq("id", row.id);
      row.content = `${row.content}\n[Visual analysis unavailable]`;
    }
  }
}
