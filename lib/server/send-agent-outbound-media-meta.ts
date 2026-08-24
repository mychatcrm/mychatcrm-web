import "server-only";

import { sendWhatsAppMediaMessage } from "@/lib/integrations/whatsapp-cloud";
import {
  sendAgentOutboundMedia,
  type SendAgentOutboundMediaResult,
} from "@/lib/server/send-agent-outbound-media";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function sendAgentOutboundMediaViaMeta(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  phoneNumberId: string;
  accessToken: string;
  toWaId: string;
  originalFilenames: string[];
  remoteJid: string;
  journeyId: string;
  ruleId: string;
  operationKeyPrefix: string;
  leadId?: string | null;
}): Promise<SendAgentOutboundMediaResult> {
  return sendAgentOutboundMedia({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
    originalFilenames: params.originalFilenames,
    remoteJid: params.remoteJid,
    journeyId: params.journeyId,
    ruleId: params.ruleId,
    connectionId: params.phoneNumberId,
    operationKeyPrefix: params.operationKeyPrefix,
    leadId: params.leadId,
    transport: {
      channel: "meta_cloud",
      deliver: async ({ file, kind, mediaUrl }) => {
        const sent = await sendWhatsAppMediaMessage({
          toWaId: params.toWaId,
          kind,
          phoneNumberId: params.phoneNumberId,
          accessToken: params.accessToken,
          link: mediaUrl,
          filename: kind === "document" ? file.originalFilename : null,
        });
        return {
          ok: sent.ok,
          providerMessageId: sent.messageId ?? null,
          error: sent.error ?? null,
        };
      },
    },
  });
}
