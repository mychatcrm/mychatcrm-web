import "server-only";

import {
  createR2PresignedGetUrl,
  isR2Configured,
} from "@/lib/integrations/r2-storage";
import {
  findReadyAgentMediaByFilenameFlexible,
  lookupReadyAgentMediaForOutbound,
  type AgentMediaFile,
} from "@/lib/server/agent-media-files";
import {
  finalizeAgentOutboundDelivery,
  markAgentOutboundFailed,
  prepareAutomatedOutbound,
} from "@/lib/server/agent-outbound-outbox";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;
export type AgentOutboundMediaKind = "audio" | "image" | "video" | "document";

export type AgentOutboundMediaDelivery = {
  ok: boolean;
  providerMessageId?: string | null;
  providerRemoteJid?: string | null;
  providerStatus?: string | null;
  deliveryStatus?: string | null;
  error?: string | null;
};

export type AgentOutboundMediaTransport = {
  channel: "evolution" | "meta_cloud";
  deliver(params: {
    file: AgentMediaFile;
    kind: AgentOutboundMediaKind;
    mediaUrl: string;
  }): Promise<AgentOutboundMediaDelivery>;
};

export type SendAgentOutboundMediaParams = {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  originalFilenames: string[];
  remoteJid: string;
  journeyId: string;
  ruleId: string;
  connectionId: string;
  operationKeyPrefix: string;
  leadId?: string | null;
  transport: AgentOutboundMediaTransport;
};

export type SendAgentOutboundMediaResult = {
  sent: number;
  alreadySent: number;
};

const PRESIGNED_GET_TTL_SECONDS = 3600;
const OUTBOUND_MEDIA_SEND_GAP_MS = 600;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function primaryMime(mime: string): string {
  return mime.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function mediaKind(file: AgentMediaFile): AgentOutboundMediaKind {
  const mime = primaryMime(file.mimeType);
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

function outboundActionError(
  action: Exclude<
    Awaited<ReturnType<typeof prepareAutomatedOutbound>>["action"],
    "send" | "already_sent"
  >,
  reason?: string,
): string {
  if (action === "blocked") return `authorization_blocked:${reason ?? "blocked"}`;
  if (action === "stale") return "generation_stale";
  return `outbound_dispatch_${action}`;
}

/**
 * Pipeline compartilhado de anexos automáticos.
 *
 * Lookup, idempotência, autorização fail-closed e auditoria são iguais em
 * todos os canais. Apenas a chamada final ao provedor é um adaptador. Qualquer
 * falha é propagada: o job pode recuperar/reconciliar em vez de fingir sucesso.
 */
export async function sendAgentOutboundMedia(
  params: SendAgentOutboundMediaParams,
): Promise<SendAgentOutboundMediaResult> {
  if (!params.originalFilenames.length) return { sent: 0, alreadySent: 0 };
  if (!isR2Configured()) throw new Error("agent_media_storage_unavailable");
  if (!params.connectionId.trim()) throw new Error("agent_media_connection_missing");

  const sb = params.sb ?? createSupabaseServiceClient();
  let sent = 0;
  let alreadySent = 0;

  for (let index = 0; index < params.originalFilenames.length; index += 1) {
    const candidate = params.originalFilenames[index]!;
    let file = await lookupReadyAgentMediaForOutbound({
      sb,
      tenantId: params.tenantId,
      agentId: params.agentId,
      filename: candidate,
    });
    if (!file) {
      file = await findReadyAgentMediaByFilenameFlexible({
        sb,
        tenantId: params.tenantId,
        agentId: params.agentId,
        candidateName: candidate,
      });
    }
    if (!file) throw new Error(`agent_media_not_found:index_${index}`);

    const kind = mediaKind(file);
    const outbound = await prepareAutomatedOutbound({
      sb,
      operationKey: `${params.operationKeyPrefix}:media:${index}`,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      agentId: params.agentId,
      journeyId: params.journeyId,
      ruleId: params.ruleId,
      connectionId: params.connectionId,
      channel: params.transport.channel,
      kind,
      content: file.originalFilename,
      leadId: params.leadId ?? null,
    });
    if (outbound.action === "already_sent") {
      alreadySent += 1;
      continue;
    }
    if (outbound.action !== "send") {
      throw new Error(
        outboundActionError(
          outbound.action,
          outbound.action === "blocked" ? outbound.reason : undefined,
        ),
      );
    }

    let delivery: AgentOutboundMediaDelivery;
    try {
      const mediaUrl = await createR2PresignedGetUrl({
        key: file.storageKey,
        expiresInSeconds: PRESIGNED_GET_TTL_SECONDS,
      });
      delivery = await params.transport.deliver({ file, kind, mediaUrl });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : `${params.transport.channel}_media_delivery_failed`;
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: reason,
      });
      throw new Error(`${params.transport.channel}_media_delivery_failed:${reason}`);
    }

    if (!delivery.ok) {
      const reason = delivery.error || `${params.transport.channel}_media_provider_failed`;
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: reason,
      });
      throw new Error(`${params.transport.channel}_media_delivery_failed:${reason}`);
    }

    await finalizeAgentOutboundDelivery({
      sb,
      id: outbound.id,
      claimToken: outbound.claimToken,
      providerMessageId: delivery.providerMessageId ?? null,
      kind,
      content: file.originalFilename,
      providerRemoteJid: delivery.providerRemoteJid ?? null,
      providerStatus: delivery.providerStatus ?? null,
      deliveryStatus: delivery.deliveryStatus ?? "sent",
    });
    sent += 1;

    if (index < params.originalFilenames.length - 1) {
      await sleepMs(OUTBOUND_MEDIA_SEND_GAP_MS);
    }
  }

  return { sent, alreadySent };
}
