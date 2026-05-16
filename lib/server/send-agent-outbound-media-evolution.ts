import "server-only";

import { evolutionSendAudio, evolutionSendMedia } from "@/lib/integrations/evolution-api";
import { createR2PresignedGetUrl, isR2Configured } from "@/lib/integrations/r2-storage";
import {
  findReadyAgentMediaByFilenameFlexible,
  lookupReadyAgentMediaForOutbound,
} from "@/lib/server/agent-media-files";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SendOpts = {
  tenantId: string;
  agentId: string;
  instanceName: string;
  /** Número Evolution (só dígitos, com DDI). */
  number: string;
  originalFilenames: string[];
};

function primaryMime(mime: string): string {
  const base = mime.split(";")[0]?.trim() ?? "";
  return base || "application/octet-stream";
}

const PRESIGNED_GET_TTL_SECONDS = 3600;
const OUTBOUND_MEDIA_SEND_GAP_MS = 600;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envia ficheiros configurados no agente pela Evolution, na ordem pedida (sequencial).
 * O texto introdutório deve ser enviado pelo caller (webhook / Smart Wait) antes desta função.
 * Usa URL presignada R2 (GET) para a Evolution descarregar o ficheiro.
 */
export async function sendAgentOutboundMediaViaEvolution(opts: SendOpts): Promise<void> {
  if (!opts.originalFilenames.length) return;
  if (!isR2Configured()) {
    console.warn("[outbound-media] R2 não configurado — não é possível presign GET");
    return;
  }

  const sb = createSupabaseServiceClient();

  for (let index = 0; index < opts.originalFilenames.length; index++) {
    const filename = opts.originalFilenames[index]!;
    try {
      let file = await lookupReadyAgentMediaForOutbound({
        sb,
        tenantId: opts.tenantId,
        agentId: opts.agentId,
        filename,
      });
      if (!file) {
        file = await findReadyAgentMediaByFilenameFlexible({
          sb,
          tenantId: opts.tenantId,
          agentId: opts.agentId,
          candidateName: filename,
        });
        console.log("[MEDIA_DEBUG] lookup:", { filename, found: !!file, mode: file ? "flexible" : "none" });
      }

      if (!file) {
        continue;
      }

      const mediaUrl = await createR2PresignedGetUrl({
        key: file.storageKey,
        expiresInSeconds: PRESIGNED_GET_TTL_SECONDS,
      });

      const mimeLower = primaryMime(file.mimeType).toLowerCase();
      const caption = "";
      let sendOk = false;

      if (mimeLower.startsWith("image/")) {
        const res = await evolutionSendMedia({
          instanceName: opts.instanceName,
          number: opts.number,
          mediatype: "image",
          mimetype: primaryMime(file.mimeType),
          media: mediaUrl,
          caption,
        });
        sendOk = res.ok;
        if (!res.ok) console.warn("[outbound-media] sendMedia image", res.status, res.error);
      } else if (mimeLower.startsWith("video/")) {
        const res = await evolutionSendMedia({
          instanceName: opts.instanceName,
          number: opts.number,
          mediatype: "video",
          mimetype: primaryMime(file.mimeType),
          media: mediaUrl,
          caption,
        });
        sendOk = res.ok;
        if (!res.ok) console.warn("[outbound-media] sendMedia video", res.status, res.error);
      } else if (mimeLower.startsWith("audio/")) {
        const res = await evolutionSendAudio({
          instanceName: opts.instanceName,
          number: opts.number,
          audio: mediaUrl,
        });
        sendOk = res.ok;
        if (!res.ok) console.warn("[outbound-media] sendWhatsAppAudio", res.status, res.error);
      } else {
        const res = await evolutionSendMedia({
          instanceName: opts.instanceName,
          number: opts.number,
          mediatype: "document",
          mimetype: primaryMime(file.mimeType),
          media: mediaUrl,
          caption,
          fileName: file.originalFilename,
        });
        sendOk = res.ok;
        if (!res.ok) console.warn("[outbound-media] sendMedia document", res.status, res.error);
      }

      console.log("[MEDIA_DEBUG] sent:", { filename, status: sendOk ? "ok" : "error" });
    } catch (err) {
      console.error("[MEDIA_DEBUG] error sending:", {
        filename,
        err: err instanceof Error ? err.message : err,
      });
    }

    if (index < opts.originalFilenames.length - 1) {
      await sleepMs(OUTBOUND_MEDIA_SEND_GAP_MS);
    }
  }
}
