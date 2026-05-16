import "server-only";

import { evolutionSendAudio, evolutionSendMedia } from "@/lib/integrations/evolution-api";
import { createR2PresignedGetUrl, isR2Configured } from "@/lib/integrations/r2-storage";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { findReadyAgentMediaByFilenameFlexible } from "@/lib/server/agent-media-files";
import { sleep } from "@/lib/server/agent-response-schedule";

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
/** Espaço entre envios sequenciais para evitar bloqueio por rajada no WhatsApp. */
const OUTBOUND_MEDIA_SEND_GAP_MS = 500;

/**
 * Envia ficheiros configurados no agente pela Evolution, na ordem pedida.
 * Usa URL presignada R2 (GET) em `media`/`audio` para a Evolution descarregar o ficheiro,
 * evitando buffer/base64 no servidor (timeouts em webhooks).
 */
export async function sendAgentOutboundMediaViaEvolution(opts: SendOpts): Promise<void> {
  if (!opts.originalFilenames.length) return;
  if (!isR2Configured()) {
    console.warn("[outbound-media] R2 não configurado — não é possível presign GET");
    return;
  }

  const sb = createSupabaseServiceClient();

  for (let index = 0; index < opts.originalFilenames.length; index++) {
    try {
      const name = opts.originalFilenames[index]!;
      const file = await findReadyAgentMediaByFilenameFlexible({
        sb,
        tenantId: opts.tenantId,
        agentId: opts.agentId,
        candidateName: name,
      });
      if (!file) {
        console.warn("[outbound-media] ficheiro não encontrado ou não pronto:", name);
        continue;
      }

      let mediaUrl: string;
      try {
        mediaUrl = await createR2PresignedGetUrl({
          key: file.storageKey,
          expiresInSeconds: PRESIGNED_GET_TTL_SECONDS,
        });
      } catch (e) {
        console.warn("[outbound-media] presign GET R2 falhou", file.storageKey, e);
        continue;
      }

      const mimeLower = primaryMime(file.mimeType).toLowerCase();

      if (mimeLower.startsWith("image/")) {
        const res = await evolutionSendMedia({
          instanceName: opts.instanceName,
          number: opts.number,
          mediatype: "image",
          mimetype: primaryMime(file.mimeType),
          media: mediaUrl,
          caption: file.originalFilename,
        });
        if (!res.ok) console.warn("[outbound-media] sendMedia image", res.status, res.error);
        continue;
      }

      if (mimeLower.startsWith("video/")) {
        const res = await evolutionSendMedia({
          instanceName: opts.instanceName,
          number: opts.number,
          mediatype: "video",
          mimetype: primaryMime(file.mimeType),
          media: mediaUrl,
          caption: file.originalFilename,
        });
        if (!res.ok) console.warn("[outbound-media] sendMedia video", res.status, res.error);
        continue;
      }

      if (mimeLower.startsWith("audio/")) {
        const res = await evolutionSendAudio({
          instanceName: opts.instanceName,
          number: opts.number,
          audio: mediaUrl,
        });
        if (!res.ok) console.warn("[outbound-media] sendWhatsAppAudio", res.status, res.error);
        continue;
      }

      const res = await evolutionSendMedia({
        instanceName: opts.instanceName,
        number: opts.number,
        mediatype: "document",
        mimetype: primaryMime(file.mimeType),
        media: mediaUrl,
        caption: file.originalFilename,
        fileName: file.originalFilename,
      });
      if (!res.ok) console.warn("[outbound-media] sendMedia document", res.status, res.error);
    } finally {
      if (index < opts.originalFilenames.length - 1) {
        await sleep(OUTBOUND_MEDIA_SEND_GAP_MS);
      }
    }
  }
}
