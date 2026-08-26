import {
  generateAgentResponse,
  isAgentMissingInstructionsResult,
} from "@/lib/ai/generate-agent-response";
import { agendaPlanFromResult, leadOutcomeFromResult } from "@/lib/ai/agent-turn-plan";
import {
  detectSupportedLanguageCode,
  localizedAttachmentIntro,
  resolveConfiguredConversationLanguage,
  resolveConfiguredLanguageCode,
  resolveTtsLanguageCode,
} from "@/lib/ai/language-detect";
import { localizedAgentFailureReply } from "@/lib/agents/agent-failure-reply";
import {
  canUseTts,
  resolveAgentResponseSettingsFromStorage,
  resolveTriggeringInboundKind,
} from "@/lib/agents";
import { resolveAgentTimezone } from "@/lib/agents/agent-datetime";
import { smartWaitFromMetadata } from "@/lib/agents/smart-wait-settings";
import {
  buildReplyUnitPrompt,
  normalizeConversationBurst,
} from "@/lib/conversas/normalize-conversation-burst";
import { shouldSuppressLateInboundFragment } from "@/lib/conversas/late-inbound-fragment";
import { isElevenlabsConfigured } from "@/lib/integrations/elevenlabs";
import {
  sendWhatsAppMediaMessage,
  sendWhatsAppTextMessage,
  uploadWhatsAppCloudMedia,
} from "@/lib/integrations/whatsapp-cloud";
import {
  AGENDA_AUTOMATION_DISABLED_REPLY,
  priorAgendaAssistantTextFromMessages,
  resolveAgendaTurn,
  shouldDeferHandoffForAgendaResult,
} from "@/lib/server/agent-cta-scheduler";
import {
  finalizeAgentOutboundDelivery,
  markAgentOutboundFailed,
  prepareAgentOutbound,
} from "@/lib/server/agent-outbound-outbox";
import {
  isAgentConversationSequenceCurrent,
  type AgentResponseJobRow,
} from "@/lib/server/agent-response-jobs";
import { getRecentConversationMessages } from "@/lib/server/conversation-memory";
import {
  completeAgentHandoff,
  detectAgentHandoff,
  resolveAgentHandoffSettings,
} from "@/lib/server/agent-handoff-runtime";
import { resolveOutboundMediaForAgentResponse } from "@/lib/server/agent-media-files";
import { deliverAgentReplyWithOptionalTts } from "@/lib/server/agent-tts-outbound";
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
import { applyCrmMoveOnLeadReply } from "@/lib/server/agent-crm-move";
import { applyAgentLeadOutcome } from "@/lib/server/agent-lead-outcome";
import { scheduleLeadRedistribution } from "@/lib/server/lead-redistribution";
import { getTenantPlanSnapshot } from "@/lib/server/tenant-plan-snapshot";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import { sendAgentOutboundMediaViaMeta } from "@/lib/server/send-agent-outbound-media-meta";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  AgentAgendaDisponibilidade,
  AgentAgendaLembretes,
  AgentFollowUpInteligente,
} from "@/lib/types";
import { processMetaAgentResponseJob as processMetaAgentResponseJobV2 } from "@/lib/server/meta-agent-adapter-v2";

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

function providerMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { messageId?: unknown }).messageId;
  return typeof value === "string" && value.trim() ? value : null;
}

/** Processador Meta que usa o mesmo burst e as mesmas garantias do Evolution. */
export async function processMetaAgentResponseJob(
  sb: SupabaseServiceClient,
  job: AgentResponseJobRow,
  generation: number,
): Promise<JobResult> {
  // Assinatura estável para rollback e mocks; todas as decisões são do V2.
  if (process.env.AGENT_TURN_V2 !== "off") {
    return processMetaAgentResponseJobV2(sb, job, generation);
  }
  if (!job.connection_id) return { ok: false, error: "meta_connection_missing" };
  if (
    await isGenerationStale(sb, job.id, generation) ||
    !(await isAgentConversationSequenceCurrent(sb, job))
  ) {
    return { ok: false, error: "generation_stale" };
  }

  const connection = await lookupWhatsAppCloudConnectionByPhoneNumberId(
    job.connection_id,
  );
  if (!connection || connection.tenant_id !== job.tenant_id || !connection.active) {
    return { ok: false, error: "meta_connection_not_authorized" };
  }

  const journeyAuth = job.journey_id
    ? await authorizeActiveJourney({
        sb,
        tenantId: job.tenant_id,
        remoteJid: job.remote_jid,
        preferredAgentId: job.agent_id,
        connectionId: job.connection_id,
        channel: "meta_cloud",
      })
    : null;
  if (
    isJourneyIsolationEnabled() &&
    (!job.journey_id || !journeyAuth?.ok || journeyAuth.journey?.id !== job.journey_id)
  ) {
    return {
      ok: false,
      error: !job.journey_id
        ? "missing_active_journey"
        : journeyAuth?.ok
          ? "journey_id_mismatch"
          : journeyAuth?.reason ?? "journey_not_authorized",
    };
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
    .select("metadata,voice_id,response_mode")
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
      burstMode: "exact",
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
  const handoffSettings = resolveAgentHandoffSettings(metadata);
  const handoffDecision = await detectAgentHandoff({
    settings: handoffSettings,
    customerText: unitPrompt,
    modelText: replyText,
  });
  let handoffTriggered = handoffDecision.triggered;
  let handoffReason = handoffDecision.reason;
  replyText = handoffDecision.cleanModelText;

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
  const agendaTurn = await resolveAgendaTurn({
    sb,
    tenantId: job.tenant_id,
    remoteJid: job.remote_jid,
    leadId: job.lead_id,
    agentId: job.agent_id,
    timezone,
    modelText: replyText,
    agendaPlan: agendaPlanFromResult(result),
    clientText,
    languageCode: resolveConfiguredLanguageCode(
      typeof metadata.idioma === "string" ? metadata.idioma : null,
      clientText,
    ),
    languageTag: (() => {
      const resolved = resolveConfiguredConversationLanguage(
        typeof metadata.idioma === "string" ? metadata.idioma : null,
        clientText,
      );
      return resolved.ok ? resolved.tag : null;
    })(),
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
  if (shouldDeferHandoffForAgendaResult(agendaTurn)) {
    handoffTriggered = false;
    handoffReason = null;
  }
  replyText = agendaTurn.action === "blocked"
    ? AGENDA_AUTOMATION_DISABLED_REPLY
    : agendaTurn.text;
  if (await isGenerationStale(sb, job.id, generation)) {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }

  const languageCode = resolveConfiguredLanguageCode(
    typeof metadata.idioma === "string" ? metadata.idioma : null,
    clientText,
  );
  const outboundMedia = await resolveOutboundMediaForAgentResponse({
    sb,
    tenantId: job.tenant_id,
    agentId: job.agent_id,
    responseText: replyText,
    userRequestText: unitPrompt,
  });
  let textToSend = outboundMedia.cleanedText.trim();
  if (handoffTriggered && handoffSettings.message) {
    textToSend = handoffSettings.message;
  }
  if (agendaTurn.action === "blocked") {
    textToSend = AGENDA_AUTOMATION_DISABLED_REPLY;
  } else if (agendaTurn.action === "failed") {
    textToSend = agendaTurn.text;
  }
  if (!textToSend && outboundMedia.filenames.length) {
    const resolvedLanguage = resolveConfiguredConversationLanguage(
      typeof metadata.idioma === "string" ? metadata.idioma : null,
      clientText,
    );
    textToSend = localizedAttachmentIntro(
      resolvedLanguage.ok ? resolvedLanguage.tag : null,
    );
  }

  const { responseMode, voiceId } = resolveAgentResponseSettingsFromStorage({
    response_mode: agentRow?.response_mode,
    voice_id: agentRow?.voice_id,
    metadata: agentRow?.metadata,
  });
  const triggeringMessageId = job.message_ids[job.message_ids.length - 1] ?? null;
  const triggeringInboundKind = resolveTriggeringInboundKind(
    inboundRows,
    triggeringMessageId,
  );
  const useTts = canUseTts({
    agentResponseMode: responseMode,
    inboundKind: triggeringInboundKind,
    voiceId,
    elevenLabsAvailable: isElevenlabsConfigured(),
    handoffTriggered,
  });

  const outbound = await prepareAgentOutbound({
    sb,
    job,
    generation,
    kind: useTts ? "audio" : "text",
    content: textToSend.slice(0, 4000),
  });
  const primaryAlreadySent = outbound.action === "already_sent";
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

  const token = connection.access_token.trim();
  if (!token) {
    if (outbound.action === "send") {
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: "meta_access_token_missing",
      });
    }
    return { ok: false, error: "meta_access_token_missing", dedupedCount: burst.dedupedCount };
  }

  const phone = job.remote_jid.replace(/\D/g, "");
  let quotaReservationId: string | null = null;
  let sentAt = new Date().toISOString();

  if (!primaryAlreadySent && outbound.action === "send") {
    const currentJourney = job.journey_id
      ? await authorizeActiveJourney({
          sb,
          tenantId: job.tenant_id,
          remoteJid: job.remote_jid,
          preferredAgentId: job.agent_id,
          connectionId: job.connection_id,
          channel: "meta_cloud",
        })
      : null;
    if (
      isJourneyIsolationEnabled() &&
      (!currentJourney?.ok || currentJourney.journey?.id !== job.journey_id)
    ) {
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: "journey_superseded_before_send",
      });
      return { ok: false, error: "journey_superseded_before_send", dedupedCount: burst.dedupedCount };
    }

    if (currentJourney?.ok && currentJourney.journey?.source === "whatsapp_direct") {
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
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: "generation_stale",
      });
      await releaseTenantLeadQuotaReservation(quotaReservationId, "generation_stale");
      return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
    }

    const delivery = await deliverAgentReplyWithOptionalTts({
      instanceName: job.connection_id,
      number: phone,
      text: textToSend,
      voiceId: voiceId ?? "",
      languageCode: resolveTtsLanguageCode(textToSend),
      tenantId: job.tenant_id,
      useTts,
      logScope: "meta-agent-reply",
      logContext: { job_id: job.id, tenant_id: job.tenant_id, agent_id: job.agent_id },
      sendText: async () => {
        const sent = await sendWhatsAppTextMessage({
          toWaId: phone,
          text: textToSend.slice(0, 4000),
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
    if (!delivery.sent) {
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: "meta_send_failed",
      });
      await releaseTenantLeadQuotaReservation(quotaReservationId, "meta_delivery_failed");
      return { ok: false, error: "meta_send_failed", dedupedCount: burst.dedupedCount };
    }

    const sentMessageId = providerMessageId(delivery.providerPayload);
    await finalizeAgentOutboundDelivery({
      sb,
      id: outbound.id,
      claimToken: outbound.claimToken,
      providerMessageId: sentMessageId,
      kind: delivery.channel === "audio" ? "audio" : "text",
      content: textToSend.slice(0, 4000),
      mediaUrl: delivery.mediaUrl ?? null,
      deliveryStatus: "sent",
    });
    sentAt = new Date().toISOString();
    await commitTenantLeadQuotaReservation({
      eventId: quotaReservationId,
      leadId: job.lead_id,
      journeyId: job.journey_id,
    });
  }

  if (outboundMedia.filenames.length) {
    if (!job.journey_id || !job.rule_id) {
      return { ok: false, error: "agent_media_authorization_context_missing", dedupedCount: burst.dedupedCount };
    }
    await sendAgentOutboundMediaViaMeta({
      sb,
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      phoneNumberId: job.connection_id,
      accessToken: token,
      toWaId: phone,
      originalFilenames: outboundMedia.filenames,
      remoteJid: job.remote_jid,
      journeyId: job.journey_id,
      ruleId: job.rule_id,
      operationKeyPrefix: `agent-response:${job.id}:${generation}`,
      leadId: job.lead_id,
    });
  }

  if (handoffTriggered) {
    await completeAgentHandoff({
      sb,
      job,
      reason: handoffReason ?? "handoff",
      lastCustomerMessage: unitPrompt,
      notificationNumber: handoffSettings.notificationNumber,
    });
  }

  if (job.lead_id) {
    await sb
      .from("leads")
      .update({ last_message_at: sentAt, updated_at: sentAt })
      .eq("tenant_id", job.tenant_id)
      .eq("id", job.lead_id);
  }
  // Este job só existe porque o lead mandou mensagem — é o ponto onde "o lead
  // respondeu" é verdade. Move o card uma vez, se o agente tiver esse destino
  // configurado. Nunca lança: a resposta ao lead não pode falhar por causa do CRM.
  await applyCrmMoveOnLeadReply({
    sb,
    tenantId: job.tenant_id,
    agentId: job.agent_id,
    leadId: job.lead_id,
  });
  // Descarte do lead, se o agente declarou e o dono configurou. Depois do
  // envio: a última mensagem já saiu e só então o atendimento é encerrado.
  await applyAgentLeadOutcome({
    sb,
    tenantId: job.tenant_id,
    remoteJid: job.remote_jid,
    agentId: job.agent_id,
    leadId: job.lead_id,
    outcome: leadOutcomeFromResult(result),
    customerEvidenceTexts: unit.map((message) => message.content),
    metadata,
  });
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
  return { ok: true, dedupedCount: burst.dedupedCount };
}
