import "server-only";

import { evolutionSendAudio, evolutionSendMedia } from "@/lib/integrations/evolution-api";
import { getMediaBufferFromR2 } from "@/lib/integrations/r2-storage";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { findReadyAgentMediaByFilenameFlexible } from "@/lib/server/agent-media-files";

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

/**
 * Envia ficheiros configurados no agente pela Evolution, na ordem pedida.
 * O ramo Evolution segue o `mime_type` gravado na BD (image / video / áudio / documento).
 */
export async function sendAgentOutboundMediaViaEvolution(opts: SendOpts): Promise<void> {
  if (!opts.originalFilenames.length) return;
  const sb = createSupabaseServiceClient();

  for (const name of opts.originalFilenames) {
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

    let buffer: Buffer;
    try {
      buffer = await getMediaBufferFromR2(file.storageKey);
    } catch (e) {
      console.warn("[outbound-media] download R2 falhou", file.storageKey, e);
      continue;
    }

    const b64 = buffer.toString("base64");
    const mimeLower = primaryMime(file.mimeType).toLowerCase();

    if (mimeLower.startsWith("image/")) {
      const res = await evolutionSendMedia({
        instanceName: opts.instanceName,
        number: opts.number,
        mediatype: "image",
        mimetype: primaryMime(file.mimeType),
        media: b64,
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
        media: b64,
        caption: file.originalFilename,
      });
      if (!res.ok) console.warn("[outbound-media] sendMedia video", res.status, res.error);
      continue;
    }

    if (mimeLower.startsWith("audio/")) {
      const res = await evolutionSendAudio({
        instanceName: opts.instanceName,
        number: opts.number,
        audio: b64,
      });
      if (!res.ok) console.warn("[outbound-media] sendWhatsAppAudio", res.status, res.error);
      continue;
    }

    const res = await evolutionSendMedia({
      instanceName: opts.instanceName,
      number: opts.number,
      mediatype: "document",
      mimetype: primaryMime(file.mimeType),
      media: b64,
      caption: file.originalFilename,
      fileName: file.originalFilename,
    });
    if (!res.ok) console.warn("[outbound-media] sendMedia document", res.status, res.error);
  }
}
