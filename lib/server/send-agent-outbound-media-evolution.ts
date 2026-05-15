import "server-only";

import { evolutionSendAudio, evolutionSendMedia } from "@/lib/integrations/evolution-api";
import { getMediaBufferFromR2 } from "@/lib/integrations/r2-storage";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { findReadyAgentMediaByOriginalFilename } from "@/lib/server/agent-media-files";

type SendOpts = {
  tenantId: string;
  agentId: string;
  instanceName: string;
  /** Número Evolution (só dígitos, com DDI). */
  number: string;
  originalFilenames: string[];
};

/**
 * Envia ficheiros configurados no agente pela Evolution, na ordem pedida.
 */
export async function sendAgentOutboundMediaViaEvolution(opts: SendOpts): Promise<void> {
  if (!opts.originalFilenames.length) return;
  const sb = createSupabaseServiceClient();

  for (const name of opts.originalFilenames) {
    const file = await findReadyAgentMediaByOriginalFilename({
      sb,
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      originalFilename: name,
    });
    if (!file) {
      console.warn("[outbound-media] ficheiro não encontrado ou não pronto:", name);
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await getMediaBufferFromR2(file.storageKey);
    } catch (e) {
      console.warn("[outbound-media] download R2 falhou", file.storageKey, e);
      continue;
    }

    const b64 = buffer.toString("base64");
    const mime = file.mimeType.toLowerCase();

    if (mime.startsWith("image/")) {
      const res = await evolutionSendMedia({
        instanceName: opts.instanceName,
        number: opts.number,
        mediatype: "image",
        mimetype: file.mimeType,
        media: b64,
        caption: file.originalFilename,
      });
      if (!res.ok) {
        console.warn("[outbound-media] sendMedia image", res.status, res.error);
      }
      continue;
    }

    if (mime === "video/mp4" || mime.startsWith("video/")) {
      const res = await evolutionSendMedia({
        instanceName: opts.instanceName,
        number: opts.number,
        mediatype: "video",
        mimetype: file.mimeType,
        media: b64,
        caption: file.originalFilename,
      });
      if (!res.ok) {
        console.warn("[outbound-media] sendMedia video", res.status, res.error);
      }
      continue;
    }

    const res = await evolutionSendAudio({
      instanceName: opts.instanceName,
      number: opts.number,
      audio: b64,
    });
    if (!res.ok) {
      console.warn("[outbound-media] sendWhatsAppAudio", res.status, res.error);
    }
  }
}
