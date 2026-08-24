import "server-only";

import { shouldSuppressLateInboundFragment } from "@/lib/conversas/late-inbound-fragment";
import {
  isWithinProviderBurstWindow,
  mergeProviderBurstRows,
  PROVIDER_BURST_FORWARD_MS,
  PROVIDER_BURST_LAST_LOOK_MS,
  PROVIDER_BURST_LOOKBACK_MS,
  resolveProviderBurstAnchorMs,
} from "@/lib/conversas/provider-burst-absorb";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { extractEvolutionSendReceipt } from "@/lib/integrations/evolution-message-receipt";
import { promoteLeadToContatoOnAgentEngagement } from "@/lib/server/crm-lead-lifecycle";
import { enrichAgentInboundMediaV2 } from "@/lib/server/agent-inbound-media-v2";
import { type AgentResponseJobRow } from "@/lib/server/agent-response-jobs";
import { sleep } from "@/lib/server/agent-response-schedule";
import { deliverAgentReplyWithOptionalTts } from "@/lib/server/agent-tts-outbound";
import { sendPresence, typingDelayMs } from "@/lib/server/evolution-presence";
import {
  processAgentTurnV2,
  type ProcessAgentTurnV2Result,
} from "@/lib/server/process-agent-turn-v2";
import { scheduleLeadRedistribution } from "@/lib/server/lead-redistribution";
import { sendAgentOutboundMediaViaEvolution } from "@/lib/server/send-agent-outbound-media-evolution";
import { getEvolutionInstanceByName } from "@/lib/server/tenant-evolution-instance-db";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type PendingInboundRow = {
  id: string;
  content: string;
  kind: string;
  message_id: string | null;
  remote_jid: string;
  created_at: string;
  received_at: string;
  conversation_sequence: number | null;
  is_late_fragment: boolean;
  storage_key: string | null;
  mime_type: string | null;
  analysis_status: string | null;
  ai_description: string | null;
};

type JobResult =
  | { ok: true; dedupedCount: number }
  | { ok: false; error: string; dedupedCount?: number };

const INBOUND_SELECT =
  "id,content,kind,message_id,remote_jid,created_at,received_at,conversation_sequence,is_late_fragment,storage_key,mime_type,analysis_status,ai_description";

function mergeSuppressedCount(
  result: ProcessAgentTurnV2Result,
  suppressed: number,
): JobResult {
  return result.ok
    ? { ok: true, dedupedCount: result.dedupedCount + suppressed }
    : {
        ok: false,
        error: result.error,
        dedupedCount: (result.dedupedCount ?? 0) + suppressed,
      };
}

async function loadEvolutionInbound(params: {
  sb: SupabaseServiceClient;
  job: AgentResponseJobRow;
}): Promise<PendingInboundRow[]> {
  const { sb, job } = params;
  const windowEnd = new Date(new Date(job.last_message_at).getTime() + 1).toISOString();
  let query = sb
    .from("whatsapp_messages")
    .select(INBOUND_SELECT)
    .eq("tenant_id", job.tenant_id)
    .eq("remote_jid", job.remote_jid)
    .eq("direction", "inbound")
    .eq("channel", "evolution")
    .eq("connection_id", job.connection_id)
    .gte("received_at", job.first_message_at)
    .lte("received_at", windowEnd);
  if (job.journey_id) query = query.eq("journey_id", job.journey_id);
  const { data, error } = await query.order("received_at", { ascending: true });
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as PendingInboundRow[];

  if (rows.length < job.message_ids.length) {
    const existing = new Set(rows.map((row) => row.id));
    const missing = job.message_ids.filter((id) => !existing.has(id));
    if (missing.length) {
      let missingQuery = sb
        .from("whatsapp_messages")
        .select(INBOUND_SELECT)
        .eq("tenant_id", job.tenant_id)
        .eq("remote_jid", job.remote_jid)
        .eq("direction", "inbound")
        .eq("channel", "evolution")
        .eq("connection_id", job.connection_id)
        .in("id", missing);
      if (job.journey_id) missingQuery = missingQuery.eq("journey_id", job.journey_id);
      const { data: fallback, error: fallbackError } = await missingQuery.order("received_at", {
        ascending: true,
      });
      if (fallbackError) throw new Error(fallbackError.message);
      rows = mergeProviderBurstRows(rows, (fallback ?? []) as PendingInboundRow[]);
    }
  }
  if (!rows.length) return rows;

  await sleep(PROVIDER_BURST_LAST_LOOK_MS);
  const anchor = resolveProviderBurstAnchorMs({
    providerFirstMessageAt: job.provider_first_message_at,
    inboundRows: rows,
  });
  if (anchor == null) return rows;

  let providerQuery = sb
    .from("whatsapp_messages")
    .select(INBOUND_SELECT)
    .eq("tenant_id", job.tenant_id)
    .eq("remote_jid", job.remote_jid)
    .eq("direction", "inbound")
    .eq("channel", "evolution")
    .eq("connection_id", job.connection_id)
    .gte("created_at", new Date(anchor - PROVIDER_BURST_LOOKBACK_MS).toISOString())
    .lte("created_at", new Date(anchor + PROVIDER_BURST_FORWARD_MS).toISOString());
  if (job.journey_id) providerQuery = providerQuery.eq("journey_id", job.journey_id);
  const { data: providerRows, error: providerError } = await providerQuery.order("created_at", {
    ascending: true,
  });
  if (providerError || !providerRows?.length) return rows;
  return mergeProviderBurstRows(
    rows,
    (providerRows as PendingInboundRow[]).filter((row) =>
      isWithinProviderBurstWindow(anchor, row.created_at),
    ),
  );
}

/** Evolution QR: prepara o inbound e entrega pelo provedor; decisões ficam no V2. */
export async function processEvolutionAgentResponseJob(
  sb: SupabaseServiceClient,
  job: AgentResponseJobRow,
  generation: number,
  options?: { skipGenerationCheck?: boolean },
): Promise<JobResult> {
  if (job.channel !== "evolution") return { ok: false, error: "turn_transport_mismatch" };
  if (!job.connection_id) return { ok: false, error: "evolution_connection_missing" };
  const instance = await getEvolutionInstanceByName(job.instance_name);
  if (
    !instance ||
    instance.id !== job.connection_id ||
    instance.tenant_id !== job.tenant_id ||
    instance.connection_state !== "open"
  ) {
    return { ok: false, error: "evolution_connection_not_authorized" };
  }

  let inboundRows: PendingInboundRow[];
  try {
    inboundRows = await loadEvolutionInbound({ sb, job });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "inbound_load_failed" };
  }
  if (!inboundRows.length) return { ok: false, error: "no_inbound_messages" };
  const lateIds = new Set(
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
  inboundRows = inboundRows.filter((row) => !lateIds.has(row.id));
  if (!inboundRows.length) return { ok: true, dedupedCount: lateIds.size };
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
  const number = remoteJidToEvoNumber(job.remote_jid);
  if (!number) return { ok: false, error: "invalid_remote_jid" };

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
    skipGenerationCheck: options?.skipGenerationCheck,
    transport: {
      channel: "evolution",
      slotIndex: instance.slot_index,
      releaseProviderSend: async (_context, reason) => {
        if (reason === "generation_stale") return;
        await scheduleLeadRedistribution({
          sb,
          tenantId: job.tenant_id,
          journeyId: job.journey_id,
          ruleId: null,
          currentAgentId: job.agent_id,
          trigger: "delivery_failed",
        });
      },
      deliverPrimary: async ({ text, useTts, voiceId, languageCode }) => {
        await sendPresence(
          job.instance_name,
          number,
          useTts ? "recording" : "composing",
          useTts ? 3000 : typingDelayMs(text),
        );
        const delivery = await deliverAgentReplyWithOptionalTts({
          instanceName: job.instance_name,
          number,
          text,
          voiceId: voiceId ?? "",
          languageCode,
          tenantId: job.tenant_id,
          useTts,
          logScope: "agent-response-jobs",
          logContext: {
            job_id: job.id,
            tenant_id: job.tenant_id,
            agent_id: job.agent_id,
          },
          sendText: () =>
            evolutionSendText({
              instanceName: job.instance_name,
              number,
              text: text.slice(0, 4000),
              resolveRecipient: true,
            }),
        });
        const receipt = extractEvolutionSendReceipt(delivery.providerPayload);
        return {
          sent: delivery.sent,
          kind: delivery.channel,
          mediaUrl: delivery.mediaUrl,
          providerPayload: delivery.providerPayload,
          providerMessageId: receipt.messageId,
          providerRemoteJid: receipt.remoteJid,
          providerStatus: receipt.providerStatus,
          deliveryStatus: receipt.deliveryStatus,
          error: delivery.sent ? null : "outbound_send_failed",
        };
      },
      deliverMedia: async (filenames) => {
        if (!job.journey_id || !job.rule_id) throw new Error("agent_media_authorization_context_missing");
        await sendAgentOutboundMediaViaEvolution({
          tenantId: job.tenant_id,
          agentId: job.agent_id,
          instanceName: job.instance_name,
          number,
          originalFilenames: filenames,
          remoteJid: job.remote_jid,
          journeyId: job.journey_id,
          ruleId: job.rule_id,
          connectionId: job.connection_id!,
          operationKeyPrefix: `agent-response:${job.id}:${generation}`,
          leadId: job.lead_id,
        });
      },
      afterTurnCommitted: async () => {
        await promoteLeadToContatoOnAgentEngagement({
          sb,
          tenantId: job.tenant_id,
          leadId: job.lead_id,
          agentId: job.agent_id,
        });
      },
    },
  });
  return mergeSuppressedCount(result, lateIds.size);
}
