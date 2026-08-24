import "server-only";

import { shouldSuppressLateInboundFragment } from "@/lib/conversas/late-inbound-fragment";
import {
  sendWhatsAppMediaMessage,
  sendWhatsAppTextMessage,
  uploadWhatsAppCloudMedia,
} from "@/lib/integrations/whatsapp-cloud";
import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";
import { enrichAgentInboundMediaV2 } from "@/lib/server/agent-inbound-media-v2";
import { deliverAgentReplyWithOptionalTts } from "@/lib/server/agent-tts-outbound";
import {
  commitTenantLeadQuotaReservation,
  releaseTenantLeadQuotaReservation,
  reserveTenantLeadQuota,
} from "@/lib/server/lead-quota";
import { authorizeActiveJourney } from "@/lib/server/lead-journeys";
import {
  processAgentTurnV2,
  type ProcessAgentTurnV2Result,
} from "@/lib/server/process-agent-turn-v2";
import { sendAgentOutboundMediaViaMeta } from "@/lib/server/send-agent-outbound-media-meta";
import { getTenantPlanSnapshot } from "@/lib/server/tenant-plan-snapshot";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type PendingInboundRow = {
  id: string;
  content: string;
  kind: string;
  message_id: string | null;
  created_at: string;
  received_at: string;
  is_late_fragment: boolean;
  storage_key: string | null;
  mime_type: string | null;
  analysis_status: string | null;
  ai_description: string | null;
};

type JobResult =
  | { ok: true; dedupedCount: number }
  | { ok: false; error: string; dedupedCount?: number };

function providerMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { messageId?: unknown }).messageId;
  return typeof value === "string" && value.trim() ? value : null;
}

function withSuppressedLateCount(
  result: ProcessAgentTurnV2Result,
  suppressedLateCount: number,
): JobResult {
  return result.ok
    ? { ok: true, dedupedCount: result.dedupedCount + suppressedLateCount }
    : {
        ok: false,
        error: result.error,
        dedupedCount: (result.dedupedCount ?? 0) + suppressedLateCount,
      };
}

/** Meta Cloud: recebe/persiste dados do provedor e delega toda decisão ao V2. */
export async function processMetaAgentResponseJob(
  sb: SupabaseServiceClient,
  job: AgentResponseJobRow,
  generation: number,
): Promise<JobResult> {
  if (job.channel !== "meta_cloud") return { ok: false, error: "turn_transport_mismatch" };
  if (!job.connection_id) return { ok: false, error: "meta_connection_missing" };

  const connection = await lookupWhatsAppCloudConnectionByPhoneNumberId(job.connection_id);
  if (!connection || connection.tenant_id !== job.tenant_id || !connection.active) {
    return { ok: false, error: "meta_connection_not_authorized" };
  }
  const token = connection.access_token.trim();
  if (!token) return { ok: false, error: "meta_access_token_missing" };

  const { data: inboundData, error: inboundError } = await sb
    .from("whatsapp_messages")
    .select("id,content,kind,message_id,created_at,received_at,is_late_fragment,storage_key,mime_type,analysis_status,ai_description")
    .eq("tenant_id", job.tenant_id)
    .eq("remote_jid", job.remote_jid)
    .eq("direction", "inbound")
    .eq("channel", "meta_cloud")
    .eq("connection_id", job.connection_id)
    .in("id", job.message_ids)
    .order("received_at", { ascending: true });
  if (inboundError) return { ok: false, error: inboundError.message };
  let inboundRows = (inboundData ?? []) as PendingInboundRow[];
  if (!inboundRows.length || inboundRows.length < job.message_ids.length) {
    return { ok: false, error: "incomplete_inbound_burst" };
  }

  const suppressedLateIds = new Set(
    inboundRows
      .filter((row) =>
        shouldSuppressLateInboundFragment({
          isLateFragment: row.is_late_fragment,
          kind: row.kind,
          content: row.content,
        }),
      )
      .map((row) => row.id),
  );
  inboundRows = inboundRows.filter((row) => !suppressedLateIds.has(row.id));
  if (!inboundRows.length) return { ok: true, dedupedCount: suppressedLateIds.size };
  await enrichAgentInboundMediaV2(sb, inboundRows);

  const { data: agentRow, error: agentError } = await sb
    .from("tenant_agents")
    .select("metadata,voice_id,response_mode,review_reasons")
    .eq("tenant_id", job.tenant_id)
    .eq("agent_id", job.agent_id)
    .eq("active", true)
    .maybeSingle();
  if (agentError || !agentRow) {
    return { ok: false, error: agentError?.message ?? "agent_not_found" };
  }
  const metadata =
    agentRow.metadata && typeof agentRow.metadata === "object"
      ? (agentRow.metadata as Record<string, unknown>)
      : {};
  const reviewReasons = Array.isArray(agentRow.review_reasons)
    ? agentRow.review_reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  const phone = job.remote_jid.replace(/\D/g, "");
  if (!phone) return { ok: false, error: "invalid_remote_jid" };

  let quotaReservationId: string | null = null;
  const result = await processAgentTurnV2({
    sb,
    job,
    generation,
    inbound: inboundRows.map((row) => ({
      id: row.id,
      content: row.content,
      kind: row.kind,
      messageId: row.message_id,
    })),
    metadata,
    reviewReasons,
    storedResponseMode: agentRow.response_mode,
    storedVoiceId: agentRow.voice_id,
    transport: {
      channel: "meta_cloud",
      slotIndex: connection.slot_index ?? 0,
      beforeProviderSend: async () => {
        const journey = job.journey_id
          ? await authorizeActiveJourney({
              sb,
              tenantId: job.tenant_id,
              remoteJid: job.remote_jid,
              preferredAgentId: job.agent_id,
              connectionId: job.connection_id,
              channel: "meta_cloud",
            })
          : null;
        if (!journey?.ok || journey.journey?.source !== "whatsapp_direct") return null;
        const tenantPlan = await getTenantPlanSnapshot(job.tenant_id);
        const admission = await reserveTenantLeadQuota({
          tenantId: job.tenant_id,
          plan: tenantPlan.plan,
          operationalLimits: tenantPlan.operationalLimits,
          contactKey: job.remote_jid,
          source: "whatsapp_direct",
          idempotencyKey: `direct-cloud:${job.connection_id}:${phone}`,
          isExistingContact: Boolean(job.lead_id),
          metadata: {
            connection_id: job.connection_id,
            journey_id: job.journey_id,
            agent_id: job.agent_id,
          },
        });
        if (!admission.admitted) throw new Error(admission.reason);
        quotaReservationId = admission.eventId;
        return admission.eventId;
      },
      releaseProviderSend: async (_context, reason) => {
        await releaseTenantLeadQuotaReservation(quotaReservationId, reason);
      },
      commitProviderSend: async () => {
        await commitTenantLeadQuotaReservation({
          eventId: quotaReservationId,
          leadId: job.lead_id,
          journeyId: job.journey_id,
        });
      },
      deliverPrimary: async ({ text, useTts, voiceId, languageCode }) => {
        const delivery = await deliverAgentReplyWithOptionalTts({
          instanceName: job.connection_id!,
          number: phone,
          text,
          voiceId: voiceId ?? "",
          languageCode,
          tenantId: job.tenant_id,
          useTts,
          logScope: "meta-agent-reply",
          logContext: {
            job_id: job.id,
            tenant_id: job.tenant_id,
            agent_id: job.agent_id,
          },
          sendText: async () => {
            const sent = await sendWhatsAppTextMessage({
              toWaId: phone,
              text: text.slice(0, 4000),
              phoneNumberId: job.connection_id!,
              accessToken: token,
            });
            return { ...sent, data: { messageId: sent.messageId ?? null } };
          },
          sendAudio: async (audio) => {
            const upload = await uploadWhatsAppCloudMedia({
              phoneNumberId: job.connection_id!,
              accessToken: token,
              buffer: audio,
              mimeType: "audio/mpeg",
              filename: "agent-reply.mp3",
            });
            if (!upload.ok || !upload.mediaId) return upload;
            const sent = await sendWhatsAppMediaMessage({
              toWaId: phone,
              kind: "audio",
              phoneNumberId: job.connection_id!,
              accessToken: token,
              mediaId: upload.mediaId,
            });
            return { ...sent, data: { messageId: sent.messageId ?? null } };
          },
        });
        return {
          sent: delivery.sent,
          kind: delivery.channel,
          mediaUrl: delivery.mediaUrl,
          providerPayload: delivery.providerPayload,
          providerMessageId: providerMessageId(delivery.providerPayload),
          error: delivery.sent ? null : "meta_send_failed",
        };
      },
      deliverMedia: async (filenames) => {
        if (!job.journey_id || !job.rule_id) throw new Error("agent_media_authorization_context_missing");
        await sendAgentOutboundMediaViaMeta({
          sb,
          tenantId: job.tenant_id,
          agentId: job.agent_id,
          phoneNumberId: job.connection_id!,
          accessToken: token,
          toWaId: phone,
          originalFilenames: filenames,
          remoteJid: job.remote_jid,
          journeyId: job.journey_id,
          ruleId: job.rule_id,
          operationKeyPrefix: `agent-response:${job.id}:${generation}`,
          leadId: job.lead_id,
        });
      },
    },
  });
  return withSuppressedLateCount(result, suppressedLateIds.size);
}
