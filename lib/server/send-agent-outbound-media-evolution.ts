import "server-only";

import {
  evolutionSendAudio,
  evolutionSendMedia,
  resolveEvolutionSendNumber,
} from "@/lib/integrations/evolution-api";
import {
  sendAgentOutboundMedia,
  type SendAgentOutboundMediaResult,
} from "@/lib/server/send-agent-outbound-media";

type SendOpts = {
  tenantId: string;
  agentId: string;
  instanceName: string;
  /** Número Evolution (só dígitos, com DDI). */
  number: string;
  originalFilenames: string[];
  remoteJid: string;
  journeyId: string;
  ruleId: string;
  connectionId: string;
  operationKeyPrefix: string;
  leadId?: string | null;
};

function primaryMime(mime: string): string {
  const base = mime.split(";")[0]?.trim() ?? "";
  return base || "application/octet-stream";
}

/**
 * Envia ficheiros configurados no agente pela Evolution, na ordem pedida (sequencial).
 * O texto introdutório deve ser enviado pelo caller (webhook / Smart Wait) antes desta função.
 * Usa URL presignada R2 (GET) para a Evolution descarregar o ficheiro.
 */
export async function sendAgentOutboundMediaViaEvolution(
  opts: SendOpts,
): Promise<SendAgentOutboundMediaResult> {
  const resolvedRecipient = await resolveEvolutionSendNumber({
    instanceName: opts.instanceName,
    number: opts.number,
  });
  if (resolvedRecipient.status === "not_found") {
    throw new Error("evolution_media_recipient_not_found");
  }
  const sendNumber = resolvedRecipient.status === "exists" ? resolvedRecipient.sendNumber : opts.number;

  return sendAgentOutboundMedia({
    tenantId: opts.tenantId,
    agentId: opts.agentId,
    originalFilenames: opts.originalFilenames,
    remoteJid: opts.remoteJid,
    journeyId: opts.journeyId,
    ruleId: opts.ruleId,
    connectionId: opts.connectionId,
    operationKeyPrefix: opts.operationKeyPrefix,
    leadId: opts.leadId,
    transport: {
      channel: "evolution",
      deliver: async ({ file, kind, mediaUrl }) => {
        if (kind === "audio") {
          const result = await evolutionSendAudio({
            instanceName: opts.instanceName,
            number: sendNumber,
            audio: mediaUrl,
          });
          return {
            ok: result.ok,
            error: result.ok ? null : result.error ?? null,
          };
        }
        const result = await evolutionSendMedia({
          instanceName: opts.instanceName,
          number: sendNumber,
          mediatype: kind === "document" ? "document" : kind,
          mimetype: primaryMime(file.mimeType),
          media: mediaUrl,
          caption: "",
          ...(kind === "document" ? { fileName: file.originalFilename } : {}),
        });
        return {
          ok: result.ok,
          error: result.ok ? null : result.error ?? null,
        };
      },
    },
  });
}
