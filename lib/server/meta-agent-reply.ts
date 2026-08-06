import {
  generateAgentResponse,
  isAgentMissingInstructionsResult,
} from "@/lib/ai/generate-agent-response";
import { agendaPlanFromResult } from "@/lib/ai/agent-turn-plan";
import { detectSupportedLanguageCode, resolveConfiguredLanguageCode } from "@/lib/ai/language-detect";
import { localizedAgentFailureReply } from "@/lib/agents/agent-failure-reply";
import { resolveAgentTimezone } from "@/lib/agents/agent-datetime";
import { smartWaitFromMetadata } from "@/lib/agents/smart-wait-settings";
import {
  buildReplyUnitPrompt,
  normalizeConversationBurst,
} from "@/lib/conversas/normalize-conversation-burst";
import { shouldSuppressLateInboundFragment } from "@/lib/conversas/late-inbound-fragment";
import { sendWhatsAppTextMessage } from "@/lib/integrations/whatsapp-cloud";
import {
  AGENDA_AUTOMATION_DISABLED_REPLY,
  priorAgendaAssistantTextFromMessages,
  resolveAgendaTurn,
} from "@/lib/server/agent-cta-scheduler";
import {
  markAgentOutboundFailed,
  markAgentOutboundSent,
  prepareAgentOutbound,
} from "@/lib/server/agent-outbound-outbox";
import {
  isAgentConversationSequenceCurrent,
  type AgentResponseJobRow,
} from "@/lib/server/agent-response-jobs";
import { getRecentConversationMessages } from "@/lib/server/conversation-memory";
import {
  commitTenantLeadQuotaReservation,
  releaseTenantLeadQuotaReservation,
  reserveTenantLeadQuota,
} from "@/lib/server/lead-quota";
import {
  authorizeActiveJourney,
  isJourneyIsolationEnabled,
  touchLeadJourney,
} from "@/lib/server/lead-journeys";
import { scheduleLeadRedistribution } from "@/lib/server/lead-redistribution";
import { getTenantPlanSnapshot } from "@/lib/server/tenant-plan-snapshot";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  AgentAgendaDisponibilidade,
  AgentAgendaLembretes,
  AgentFollowUpInteligente,
} from "@/lib/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type PendingInboundRow = {
  id: string;
  content: string;
  kind: string;
  message_id: string | null;
  created_at: string;
  received_at: string;
  is_late_fragment: boolean;
};

type JobResult =
  | { ok: true; dedupedCount: number }
  | { ok: false; error: string; dedupedCount?: number };

async function isGenerationStale(
  sb: SupabaseServiceClient,
  jobId: string,
  generation: number,
): Promise<boolean> {
  const { data } = await sb
    .from("agent_response_jobs")
    .select("burst_generation,status")
    .eq("id", jobId)
    .maybeSingle();
  return !data || data.status !== "processing" || Number(data.burst_generation) !== generation;
}

function recentClientTexts(
  messages: Array<{ role: string; content: string }>,
): string[] {
  return messages
    .filter((message) => message.role === "user" && message.content.trim())
    .map((message) => message.content.trim())
    .slice(-8);
}

/** Processador Meta que usa o mesmo burst e as mesmas garantias do Evolution. */
export async function processMetaAgentResponseJob(
  sb: SupabaseServiceClient,
  job: AgentResponseJobRow,
  generation: number,
): Promise<JobResult> {
  if (!job.connection_id) return { ok: false, error: "meta_connection_missing" };
  if (
    await isGenerationStale(sb, job.id, generation) ||
    !(await isAgentConversationSequenceCurrent(sb, job))
  ) {
    return { ok: false, error: "generation_stale" };
  }

  const { data: inboundData, error: inboundError } = await sb
    .from("whatsapp_messages")
    .select("id,content,kind,message_id,created_at,received_at,is_late_fragment")
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
      .filter((row) => shouldSuppressLateInboundFragment({
        isLateFragment: row.is_late_fragment,
        kind: row.kind,
        content: row.content,
      }))
      .map((row) => row.id),
  );
  if (suppressedLateIds.size > 0) {
    inboundRows = inboundRows.filter((row) => !suppressedLateIds.has(row.id));
    if (!inboundRows.length) return { ok: true, dedupedCount: suppressedLateIds.size };
  }

  const { data: agentRow } = await sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", job.tenant_id)
    .eq("agent_id", job.agent_id)
    .maybeSingle();
  const metadata = agentRow?.metadata && typeof agentRow.metadata === "object"
    ? (agentRow.metadata as Record<string, unknown>)
    : {};
  const smartWait = smartWaitFromMetadata(metadata);
  const burst = normalizeConversationBurst(
    inboundRows.map((row) => ({
      id: row.id,
      content: row.content,
      messageId: row.message_id,
      kind: row.kind,
    })),
    {
      dedupeEnabled: smartWait.dedupeRepeated,
      burstMode: metadata.smartWaitBurstMode === "exact" ? "exact" : "relaxed",
    },
  );
  const unit = burst.canonicalMessages;
  const clientText = unit.map((message) => message.content.trim()).filter(Boolean).join("\n");
  const unitPrompt = burst.userPrompt || buildReplyUnitPrompt(unit);

  const result = await generateAgentResponse({
    tenantId: job.tenant_id,
    agentId: job.agent_id,
    conversationId: job.remote_jid,
    journeyId: job.journey_id,
    customerId: job.remote_jid,
    feature: "agent_chat",
    messages: unitPrompt ? [{ role: "user", content: unitPrompt }] : [],
    excludeMessageIds: burst.suppressedHistoryIds.filter(
      (id) => !unit.some((message) => message.id === id),
    ),
    burstContext: {
      groupedIntent: burst.signals.groupedIntent,
      urgencyLevel: burst.signals.urgencyLevel,
      responseStrategy: burst.responseStrategy,
      dominantIntent: burst.signals.dominantIntent,
    },
  });
  if (isAgentMissingInstructionsResult(result)) {
    return { ok: false, error: "agent_missing_instructions", dedupedCount: burst.dedupedCount };
  }
  let replyText = result.ok
    ? result.text
    : localizedAgentFailureReply(detectSupportedLanguageCode(unitPrompt));

  const timezone = resolveAgentTimezone({
    timezone: typeof metadata.timezone === "string" ? metadata.timezone : undefined,
    followUpInteligente: metadata.followUpInteligente as AgentFollowUpInteligente | undefined,
  });
  const history = await getRecentConversationMessages({
    sb,
    tenantId: job.tenant_id,
    remoteJid: job.remote_jid,
    journeyId: job.journey_id,
    limit: 12,
  });
  if (
    await isGenerationStale(sb, job.id, generation) ||
    !(await isAgentConversationSequenceCurrent(sb, job))
  ) {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }
  // Resolvida aqui (e não só na hora do envio) porque a linha do lembrete de
  // agenda tem que sair da conexão que hospedou a conversa.
  const connection = await lookupWhatsAppCloudConnectionByPhoneNumberId(job.connection_id);

  const agendaTurn = await resolveAgendaTurn({
    sb,
    tenantId: job.tenant_id,
    remoteJid: job.remote_jid,
    leadId: job.lead_id,
    agentId: job.agent_id,
    timezone,
    modelText: replyText.replace(/\[\[HANDOFF\]\]/gi, "").trim(),
    agendaPlan: agendaPlanFromResult(result),
    clientText,
    languageCode: resolveConfiguredLanguageCode(
      typeof metadata.idioma === "string" ? metadata.idioma : null,
      clientText,
    ),
    priorAssistantText: priorAgendaAssistantTextFromMessages(history, timezone),
    recentClientMessages: recentClientTexts(history),
    agendaAutomationEnabled: metadata.agendaAutomationEnabled === true,
    ctaHandoffAtivo: metadata.ctaHandoffAtivo === true,
    agendaLembretes:
      metadata.agendaLembretes && typeof metadata.agendaLembretes === "object"
        ? (metadata.agendaLembretes as AgentAgendaLembretes)
        : null,
    agendaDisponibilidade:
      metadata.agendaDisponibilidade && typeof metadata.agendaDisponibilidade === "object"
        ? (metadata.agendaDisponibilidade as AgentAgendaDisponibilidade)
        : null,
    slotIndex: connection?.slot_index ?? 0,
    operationKey: `agent-response-job:${job.id}:${generation}:0`,
    jobId: job.id,
    claimedGeneration: generation,
    conversationSequence: job.conversation_sequence,
    journeyId: job.journey_id,
  });
  if (agendaTurn.action === "stale") {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }
  replyText = agendaTurn.action === "blocked"
    ? AGENDA_AUTOMATION_DISABLED_REPLY
    : agendaTurn.text;
  if (await isGenerationStale(sb, job.id, generation)) {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }

  const outbound = await prepareAgentOutbound({
    sb,
    job,
    generation,
    content: replyText.slice(0, 4000),
  });
  if (outbound.action === "already_sent") {
    return { ok: true, dedupedCount: burst.dedupedCount };
  }
  if (outbound.action === "stale") {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }
  if (outbound.action === "blocked") {
    return { ok: false, error: `authorization_blocked:${outbound.reason}`, dedupedCount: burst.dedupedCount };
  }
  if (outbound.action === "ambiguous") {
    return { ok: false, error: "outbound_dispatch_ambiguous", dedupedCount: burst.dedupedCount };
  }
  if (outbound.action === "in_progress") {
    return { ok: false, error: "outbound_dispatch_in_progress", dedupedCount: burst.dedupedCount };
  }

  const token = connection?.access_token?.trim() || process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) {
    await markAgentOutboundFailed({
      sb,
      id: outbound.id,
      claimToken: outbound.claimToken,
      error: "meta_access_token_missing",
    });
    return { ok: false, error: "meta_access_token_missing", dedupedCount: burst.dedupedCount };
  }

  const phone = job.remote_jid.replace(/\D/g, "");
  let quotaReservationId: string | null = null;
  const journeyAuth = job.journey_id
    ? await authorizeActiveJourney({
        sb,
        tenantId: job.tenant_id,
        remoteJid: job.remote_jid,
        preferredAgentId: job.agent_id,
        connectionId: job.connection_id,
      })
    : null;
  if (isJourneyIsolationEnabled() && (!journeyAuth?.ok || journeyAuth.journey?.id !== job.journey_id)) {
    await markAgentOutboundFailed({
      sb,
      id: outbound.id,
      claimToken: outbound.claimToken,
      error: "journey_superseded_before_send",
    });
    return { ok: false, error: "journey_superseded_before_send", dedupedCount: burst.dedupedCount };
  }
  if (journeyAuth?.ok && journeyAuth.journey?.source === "whatsapp_direct") {
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
    if (!admission.admitted) {
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: admission.reason,
      });
      return { ok: false, error: admission.reason, dedupedCount: burst.dedupedCount };
    }
    quotaReservationId = admission.eventId;
  }

  if (!(await isAgentConversationSequenceCurrent(sb, job))) {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }
  const sent = await sendWhatsAppTextMessage({
    toWaId: job.remote_jid,
    text: replyText.slice(0, 4000),
    phoneNumberId: job.connection_id,
    accessToken: token,
  });
  if (!sent.ok) {
    await markAgentOutboundFailed({
      sb,
      id: outbound.id,
      claimToken: outbound.claimToken,
      error: sent.error || `meta_send_${sent.status}`,
    });
    await releaseTenantLeadQuotaReservation(quotaReservationId, "meta_delivery_failed");
    return { ok: false, error: "meta_send_failed", dedupedCount: burst.dedupedCount };
  }

  await markAgentOutboundSent({
    sb,
    id: outbound.id,
    claimToken: outbound.claimToken,
    providerMessageId: sent.messageId ?? null,
    job,
  });
  const sentAt = new Date().toISOString();
  await sb.from("whatsapp_messages").insert({
    tenant_id: job.tenant_id,
    remote_jid: job.remote_jid,
    direction: "outbound",
    kind: "text",
    content: replyText.slice(0, 4000),
    message_id: sent.messageId ?? null,
    provider_message_id: sent.messageId ?? null,
    agent_id: job.agent_id,
    lead_id: job.lead_id,
    journey_id: job.journey_id,
    channel: "meta_cloud",
    connection_id: job.connection_id,
  });
  if (job.lead_id) {
    await sb
      .from("leads")
      .update({ last_message_at: sentAt, updated_at: sentAt })
      .eq("tenant_id", job.tenant_id)
      .eq("id", job.lead_id);
  }
  if (job.journey_id) {
    await touchLeadJourney({
      sb,
      tenantId: job.tenant_id,
      journeyId: job.journey_id,
      leadId: job.lead_id,
      occurredAt: sentAt,
    });
    await scheduleLeadRedistribution({
      sb,
      tenantId: job.tenant_id,
      journeyId: job.journey_id,
      ruleId: journeyAuth?.ok ? journeyAuth.journey?.ruleId : null,
      currentAgentId: job.agent_id,
      trigger: "customer_silence",
    });
  }
  await commitTenantLeadQuotaReservation({
    eventId: quotaReservationId,
    leadId: job.lead_id,
    journeyId: job.journey_id,
  });
  return { ok: true, dedupedCount: burst.dedupedCount };
}
