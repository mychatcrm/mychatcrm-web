import "server-only";

import {
  generateAgentResponse,
  isAgentMissingInstructionsResult,
} from "@/lib/ai/generate-agent-response";
import {
  agendaPlanFromResult,
  leadOutcomeFromResult,
  parseAgentTurnPlan,
  type AgentAgendaPlan,
  type AgentLeadOutcome,
} from "@/lib/ai/agent-turn-plan";
import type { AgentExternalApiLookupRequest } from "@/lib/external-api/types";
import {
  resolveConfiguredConversationLanguage,
  resolveConfiguredLanguageCode,
  resolveTtsLanguageCode,
  localizedAttachmentIntro,
  type SupportedLanguageCode,
} from "@/lib/ai/language-detect";
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
import { isElevenlabsConfigured } from "@/lib/integrations/elevenlabs";
import { applyCrmMoveOnLeadReply } from "@/lib/server/agent-crm-move";
import {
  priorAgendaAssistantTextFromMessages,
  resolveAgendaTurn,
  shouldDeferHandoffForAgendaResult,
} from "@/lib/server/agent-cta-scheduler";
import {
  completeAgentHandoff,
  detectAgentHandoff,
  resolveAgentHandoffSettings,
} from "@/lib/server/agent-handoff-runtime";
import { applyAgentLeadOutcome } from "@/lib/server/agent-lead-outcome";
import { resolveOutboundMediaForAgentResponse } from "@/lib/server/agent-media-files";
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
  authorizeActiveJourney,
  isJourneyIsolationEnabled,
  touchLeadJourney,
  type JourneyAuthorizationResult,
} from "@/lib/server/lead-journeys";
import { scheduleLeadRedistribution } from "@/lib/server/lead-redistribution";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  Agent,
  AgentAgendaDisponibilidade,
  AgentAgendaLembretes,
  AgentFollowUpInteligente,
} from "@/lib/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentTurnInboundV2 = {
  id: string;
  content: string;
  kind: string;
  messageId?: string | null;
};

export type AgentTurnPrimaryDeliveryV2 = {
  sent: boolean;
  kind: "text" | "audio";
  providerMessageId?: string | null;
  providerRemoteJid?: string | null;
  providerStatus?: string | null;
  deliveryStatus?: string | null;
  mediaUrl?: string | null;
  providerPayload?: unknown;
  error?: string | null;
};

export type AgentTurnDecisionV2 = {
  reply: string;
  /** Idioma real BCP-47; languageCode existe só para cópias técnicas/TTS legado. */
  languageTag: string | null;
  languageCode: SupportedLanguageCode;
  agenda: AgentAgendaPlan | null;
  agendaBlocked: boolean;
  handoff: { triggered: boolean; reason: string | null };
  media: { filenames: string[] };
  leadOutcome: AgentLeadOutcome | null;
  externalApiLookups: AgentExternalApiLookupRequest[];
  authorization: { allowed: boolean; reason: string };
};

export type AgentTurnTransportV2 = {
  channel: "evolution" | "meta_cloud";
  slotIndex: number;
  /** A única responsabilidade específica do canal: entregar a resposta principal. */
  deliverPrimary(params: {
    text: string;
    useTts: boolean;
    voiceId: string | null;
    languageCode: SupportedLanguageCode | undefined;
  }): Promise<AgentTurnPrimaryDeliveryV2>;
  /** Anexos usam o pipeline omnichannel e o mesmo outbox, mas a chamada final é do adaptador. */
  deliverMedia?(filenames: string[]): Promise<void>;
  /** Ganchos de admissão não alteram a decisão da IA (ex.: reserva de quota orgânica). */
  beforeProviderSend?(): Promise<unknown>;
  releaseProviderSend?(context: unknown, reason: string): Promise<void>;
  commitProviderSend?(context: unknown): Promise<void>;
  afterTurnCommitted?(params: {
    decision: AgentTurnDecisionV2;
    sentAt: string;
    primaryAlreadySent: boolean;
  }): Promise<void>;
};

export type ProcessAgentTurnV2Result =
  | {
      ok: true;
      dedupedCount: number;
      decision: AgentTurnDecisionV2;
      primaryAlreadySent: boolean;
    }
  | { ok: false; error: string; dedupedCount?: number };

function consolidatedInboundText(messages: Array<{ content: string }>): string {
  return messages.map((message) => message.content.trim()).filter(Boolean).join("\n");
}

export function isValidAgentAgendaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

function recentClientTexts(messages: Array<{ role: string; content: string }>): string[] {
  return messages
    .filter((message) => message.role === "user" && message.content.trim())
    .map((message) => message.content.trim())
    .slice(-8);
}

async function generationIsStale(params: {
  sb: SupabaseServiceClient;
  job: AgentResponseJobRow;
  generation: number;
  skipGenerationCheck: boolean;
}): Promise<boolean> {
  if (params.skipGenerationCheck) return false;
  const { data, error } = await params.sb
    .from("agent_response_jobs")
    .select("burst_generation,status")
    .eq("id", params.job.id)
    .maybeSingle();
  return (
    Boolean(error) ||
    !data ||
    data.status !== "processing" ||
    Number(data.burst_generation) !== params.generation ||
    !(await isAgentConversationSequenceCurrent(params.sb, params.job))
  );
}

async function authorizeExactJourney(params: {
  sb: SupabaseServiceClient;
  job: AgentResponseJobRow;
  channel: "evolution" | "meta_cloud";
}): Promise<JourneyAuthorizationResult | null> {
  if (!params.job.journey_id) return null;
  return authorizeActiveJourney({
    sb: params.sb,
    tenantId: params.job.tenant_id,
    remoteJid: params.job.remote_jid,
    preferredAgentId: params.job.agent_id,
    connectionId: params.job.connection_id,
    channel: params.channel,
  });
}

function journeyFailure(params: {
  job: AgentResponseJobRow;
  authorization: JourneyAuthorizationResult | null;
}): string | null {
  if (!isJourneyIsolationEnabled()) return null;
  if (!params.job.journey_id) return "missing_active_journey";
  if (!params.authorization?.ok) {
    return params.authorization?.reason ?? "journey_not_authorized";
  }
  if (params.authorization.journey?.id !== params.job.journey_id) {
    return "journey_id_mismatch";
  }
  return null;
}

/**
 * Motor omnichannel canônico do turno automático.
 *
 * Evolution e Meta preparam o inbound e implementam somente a entrega. Toda
 * decisão que poderia divergir entre canais (burst, compilador V2, resposta
 * estruturada, agenda, handoff, epoch/outbox e efeitos pós-envio) vive aqui.
 */
export async function processAgentTurnV2(params: {
  sb: SupabaseServiceClient;
  job: AgentResponseJobRow;
  generation: number;
  inbound: AgentTurnInboundV2[];
  metadata: Record<string, unknown>;
  reviewReasons?: string[];
  storedResponseMode?: unknown;
  storedVoiceId?: unknown;
  transport: AgentTurnTransportV2;
  skipGenerationCheck?: boolean;
  dryRun?: boolean;
  agentOverride?: Partial<Agent>;
  model?: string;
}): Promise<ProcessAgentTurnV2Result> {
  const dryRun = params.dryRun === true;
  const skipGenerationCheck = dryRun || params.skipGenerationCheck === true;
  const { sb, job, generation, transport } = params;
  if (job.channel !== transport.channel) {
    return { ok: false, error: "turn_transport_mismatch" };
  }
  if (!dryRun && !job.connection_id) return { ok: false, error: "connection_missing" };
  if (await generationIsStale({ sb, job, generation, skipGenerationCheck })) {
    return { ok: false, error: "generation_stale" };
  }

  // 1. Jornada/regra/agente/canal/conexão exatos antes de chamar o modelo.
  let journeyAuthorization = dryRun
    ? null
    : await authorizeExactJourney({ sb, job, channel: transport.channel });
  const initialJourneyFailure = dryRun
    ? null
    : journeyFailure({ job, authorization: journeyAuthorization });
  if (initialJourneyFailure) return { ok: false, error: initialJourneyFailure };

  // 2. Um burst canônico, uma decisão lógica.
  const smartWait = smartWaitFromMetadata(params.metadata);
  const burst = normalizeConversationBurst(params.inbound, {
    dedupeEnabled: smartWait.dedupeRepeated,
    burstMode: "exact",
  });
  const unit = burst.canonicalMessages;
  if (!unit.length) {
    return {
      ok: false,
      error: "no_canonical_inbound_messages",
      dedupedCount: burst.dedupedCount,
    };
  }
  const unitPrompt = burst.userPrompt || buildReplyUnitPrompt(unit);
  const clientText = consolidatedInboundText(unit);

  const agendaTimezoneInvalid =
    params.metadata.agendaAutomationEnabled === true &&
    (params.reviewReasons?.includes("agenda_timezone_required") === true ||
      !isValidAgentAgendaTimezone(params.metadata.timezone));
  // A agenda inválida não deve nem influenciar o contexto/validação interna da
  // geração. O override é técnico e restrito a este recurso; todos os prompts
  // e o restante da configuração continuam vindo da linha real do agente.
  const effectiveAgentOverride = agendaTimezoneInvalid
    ? { ...(params.agentOverride ?? {}), agendaAutomationEnabled: false }
    : params.agentOverride;

  // 3–5. generateAgentResponse compila CompiledAgentContextV2 e normaliza o
  // contrato estruturado antes de devolver qualquer decisão ao runtime.
  const generated = await generateAgentResponse({
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
    simulation: dryRun,
    agentOverride: effectiveAgentOverride,
    model: params.model,
  });
  if (isAgentMissingInstructionsResult(generated)) {
    return {
      ok: false,
      error: "agent_missing_instructions",
      dedupedCount: burst.dedupedCount,
    };
  }
  if (!generated.ok) {
    return {
      ok: false,
      error: `agent_generation_failed:${generated.code}`,
      dedupedCount: burst.dedupedCount,
    };
  }

  const handoffSettings = resolveAgentHandoffSettings(params.metadata);
  const structuredPlan = parseAgentTurnPlan(generated.structuredData);
  if (!structuredPlan) {
    return { ok: false, error: "agent_turn_schema_mismatch", dedupedCount: burst.dedupedCount };
  }
  const handoff = await detectAgentHandoff({
    settings: handoffSettings,
    customerText: unitPrompt,
    modelText: generated.text,
    modelRequested: structuredPlan.handoff.requested,
    modelReason: structuredPlan.handoff.reason,
  });
  let handoffTriggered = handoff.triggered;
  let handoffReason = handoff.reason;
  let modelText = handoff.cleanModelText;

  const timezone = agendaTimezoneInvalid
    ? "UTC"
    : resolveAgentTimezone({
    timezone: typeof params.metadata.timezone === "string" ? params.metadata.timezone : undefined,
    followUpInteligente: params.metadata.followUpInteligente as
      | AgentFollowUpInteligente
      | undefined,
      });

  if (dryRun) {
    const conversationLanguage = resolveConfiguredConversationLanguage(
      typeof params.metadata.idioma === "string" ? params.metadata.idioma : null,
      clientText,
    );
    const languageCode = resolveConfiguredLanguageCode(
      typeof params.metadata.idioma === "string" ? params.metadata.idioma : null,
      clientText,
    );
    const media = await resolveOutboundMediaForAgentResponse({
      sb,
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      responseText: modelText,
      userRequestText: unitPrompt,
      structuredFilenames: structuredPlan.media.filenames,
    });
    const reply =
      handoffTriggered && handoffSettings.message
        ? handoffSettings.message
        : media.cleanedText.trim() || modelText;
    return {
      ok: true,
      dedupedCount: burst.dedupedCount,
      primaryAlreadySent: false,
      decision: {
        reply,
        languageTag: conversationLanguage.ok ? conversationLanguage.tag : null,
        languageCode,
        agenda: structuredPlan.agenda,
        agendaBlocked: agendaTimezoneInvalid,
        handoff: { triggered: handoffTriggered, reason: handoffReason },
        media: { filenames: media.filenames },
        leadOutcome: structuredPlan.leadOutcome,
        externalApiLookups:
          generated.externalApiLookupTrace ?? structuredPlan.externalApiLookups,
        authorization: { allowed: true, reason: "dry_run_no_business_mutations" },
      },
    };
  }
  const history = await getRecentConversationMessages({
    sb,
    tenantId: job.tenant_id,
    remoteJid: job.remote_jid,
    journeyId: job.journey_id,
    limit: 12,
  });
  if (await generationIsStale({ sb, job, generation, skipGenerationCheck })) {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }

  // 6. Exatamente uma chamada ao motor de agenda, sem alterar sua lógica.
  const agendaPlan = agendaPlanFromResult(generated);
  const agendaTurn = await resolveAgendaTurn({
    sb,
    tenantId: job.tenant_id,
    remoteJid: job.remote_jid,
    leadId: job.lead_id,
    agentId: job.agent_id,
    timezone,
    modelText,
    agendaPlan,
    clientText,
    languageCode: resolveConfiguredLanguageCode(
      typeof params.metadata.idioma === "string" ? params.metadata.idioma : null,
      clientText,
    ),
    languageTag: (() => {
      const resolved = resolveConfiguredConversationLanguage(
        typeof params.metadata.idioma === "string" ? params.metadata.idioma : null,
        clientText,
      );
      return resolved.ok ? resolved.tag : null;
    })(),
    priorAssistantText: priorAgendaAssistantTextFromMessages(history, timezone),
    recentClientMessages: recentClientTexts(history),
    // Legado sem fuso explícito continua atendendo normalmente, mas a agenda
    // fica fail-closed até o operador corrigir somente esse recurso.
    agendaAutomationEnabled:
      params.metadata.agendaAutomationEnabled === true && !agendaTimezoneInvalid,
    ctaHandoffAtivo: params.metadata.ctaHandoffAtivo === true,
    agendaLembretes:
      params.metadata.agendaLembretes && typeof params.metadata.agendaLembretes === "object"
        ? (params.metadata.agendaLembretes as AgentAgendaLembretes)
        : null,
    agendaDisponibilidade:
      params.metadata.agendaDisponibilidade &&
      typeof params.metadata.agendaDisponibilidade === "object"
        ? (params.metadata.agendaDisponibilidade as AgentAgendaDisponibilidade)
        : null,
    slotIndex: transport.slotIndex,
    operationKey: `agent-response-job:${job.id}:${generation}:0`,
    jobId: skipGenerationCheck ? null : job.id,
    claimedGeneration: skipGenerationCheck ? null : generation,
    conversationSequence: skipGenerationCheck ? null : job.conversation_sequence,
    journeyId: skipGenerationCheck ? null : job.journey_id,
  });
  if (agendaTurn.action === "stale") {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }
  if (shouldDeferHandoffForAgendaResult(agendaTurn)) {
    handoffTriggered = false;
    handoffReason = null;
  }
  modelText = agendaTurn.text;

  const languageCode = resolveConfiguredLanguageCode(
    typeof params.metadata.idioma === "string" ? params.metadata.idioma : null,
    clientText,
  );
  const conversationLanguage = resolveConfiguredConversationLanguage(
    typeof params.metadata.idioma === "string" ? params.metadata.idioma : null,
    clientText,
  );
  const media = await resolveOutboundMediaForAgentResponse({
    sb,
    tenantId: job.tenant_id,
    agentId: job.agent_id,
    responseText: modelText,
    userRequestText: unitPrompt,
    structuredFilenames: structuredPlan.media.filenames,
  });
  let textToSend = media.cleanedText.trim();
  if (handoffTriggered && handoffSettings.message) textToSend = handoffSettings.message;
  if (agendaTurn.action === "blocked") textToSend = agendaTurn.text;
  if (agendaTurn.action === "failed") textToSend = agendaTurn.text;
  if (!textToSend && media.filenames.length) {
    textToSend = localizedAttachmentIntro(
      conversationLanguage.ok ? conversationLanguage.tag : null,
    );
  }
  if (!textToSend) {
    return {
      ok: false,
      error: "empty_agent_response",
      dedupedCount: burst.dedupedCount,
    };
  }

  const { responseMode, voiceId } = resolveAgentResponseSettingsFromStorage({
    response_mode: params.storedResponseMode,
    voice_id: params.storedVoiceId,
    metadata: params.metadata,
  });
  const triggeringMessageId = job.message_ids[job.message_ids.length - 1] ?? null;
  const triggeringInboundKind = resolveTriggeringInboundKind(
    params.inbound.map((message) => ({
      id: message.id,
      kind: message.kind,
    })),
    triggeringMessageId,
  );
  const useTts = canUseTts({
    agentResponseMode: responseMode,
    inboundKind: triggeringInboundKind,
    voiceId,
    elevenLabsAvailable: isElevenlabsConfigured(),
    handoffTriggered,
  });
  const decision: AgentTurnDecisionV2 = {
    reply: textToSend,
    languageTag: conversationLanguage.ok ? conversationLanguage.tag : null,
    languageCode,
    agenda: agendaPlan,
    agendaBlocked: agendaTimezoneInvalid || agendaTurn.action === "blocked",
    handoff: { triggered: handoffTriggered, reason: handoffReason },
    media: { filenames: media.filenames },
    leadOutcome: leadOutcomeFromResult(generated),
    externalApiLookups:
      generated.externalApiLookupTrace ??
      parseAgentTurnPlan(generated.structuredData)?.externalApiLookups ??
      [],
    authorization: { allowed: true, reason: "outbox_authorized" },
  };

  // 7. Revalida geração/takeover/jornada imediatamente antes do outbox.
  if (await generationIsStale({ sb, job, generation, skipGenerationCheck })) {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }
  journeyAuthorization = await authorizeExactJourney({
    sb,
    job,
    channel: transport.channel,
  });
  const finalJourneyFailure = journeyFailure({ job, authorization: journeyAuthorization });
  if (finalJourneyFailure) {
    return { ok: false, error: finalJourneyFailure, dedupedCount: burst.dedupedCount };
  }

  // 8–9. O outbox faz a autorização transacional de automation_epoch;
  // somente depois o adaptador do canal recebe permissão para enviar.
  const outbound = await prepareAgentOutbound({
    sb,
    job,
    generation,
    kind: useTts ? "audio" : "text",
    content: textToSend.slice(0, 4000),
  });
  if (outbound.action === "stale") {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }
  if (outbound.action === "blocked") {
    return {
      ok: false,
      error: `authorization_blocked:${outbound.reason}`,
      dedupedCount: burst.dedupedCount,
    };
  }
  if (outbound.action === "ambiguous" || outbound.action === "in_progress") {
    return {
      ok: false,
      error: `outbound_dispatch_${outbound.action}`,
      dedupedCount: burst.dedupedCount,
    };
  }

  const primaryAlreadySent = outbound.action === "already_sent";
  let admissionContext: unknown;
  let providerSent = false;
  let sentAt = new Date().toISOString();
  if (!primaryAlreadySent && outbound.action === "send") {
    try {
      admissionContext = await transport.beforeProviderSend?.();
      if (await generationIsStale({ sb, job, generation, skipGenerationCheck })) {
        throw new Error("generation_stale");
      }
      const delivery = await transport.deliverPrimary({
        text: textToSend,
        useTts,
        voiceId: voiceId ?? null,
        languageCode: resolveTtsLanguageCode(textToSend),
      });
      if (!delivery.sent) throw new Error(delivery.error || "outbound_send_failed");
      providerSent = true;

      await finalizeAgentOutboundDelivery({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        providerMessageId: delivery.providerMessageId ?? null,
        kind: delivery.kind,
        content: textToSend.slice(0, 4000),
        providerRemoteJid: delivery.providerRemoteJid ?? null,
        providerStatus: delivery.providerStatus ?? null,
        deliveryStatus: delivery.deliveryStatus ?? "sent",
        mediaUrl: delivery.mediaUrl ?? null,
      });
      sentAt = new Date().toISOString();
      await transport.commitProviderSend?.(admissionContext);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "outbound_send_failed";
      if (providerSent) {
        // O provedor já aceitou o envio: nunca reverta quota nem converta o
        // outbox em retry, pois isso poderia duplicar a mensagem.
        await transport.commitProviderSend?.(admissionContext).catch(() => undefined);
      } else {
        await markAgentOutboundFailed({
          sb,
          id: outbound.id,
          claimToken: outbound.claimToken,
          error: reason,
        });
        await transport.releaseProviderSend?.(admissionContext, reason);
      }
      return { ok: false, error: reason, dedupedCount: burst.dedupedCount };
    }
  }

  try {
    if (media.filenames.length) {
      if (!job.journey_id || !transport.deliverMedia) {
        throw new Error("agent_media_authorization_context_missing");
      }
      await transport.deliverMedia(media.filenames);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "agent_media_delivery_failed",
      dedupedCount: burst.dedupedCount,
    };
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
  await applyCrmMoveOnLeadReply({
    sb,
    tenantId: job.tenant_id,
    agentId: job.agent_id,
    leadId: job.lead_id,
  });
  await applyAgentLeadOutcome({
    sb,
    tenantId: job.tenant_id,
    remoteJid: job.remote_jid,
    agentId: job.agent_id,
    leadId: job.lead_id,
    outcome: decision.leadOutcome,
    customerEvidenceTexts: unit.map((message) => message.content),
    metadata: params.metadata,
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
      ruleId: journeyAuthorization?.ok ? journeyAuthorization.journey?.ruleId : null,
      currentAgentId: job.agent_id,
      trigger: "customer_silence",
    });
  }
  await transport.afterTurnCommitted?.({ decision, sentAt, primaryAlreadySent });

  return {
    ok: true,
    dedupedCount: burst.dedupedCount,
    decision,
    primaryAlreadySent,
  };
}

/**
 * Simula o mesmo contrato de decisão da produção sem mutar jornada, agenda,
 * outbox ou WhatsApp. Consultas GET autorizadas continuam sendo resolvidas
 * dentro de generateAgentResponse e preservam rate limit/auditoria operacional.
 */
export async function simulateAgentTurnV2(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  agent: Partial<Agent>;
  message: string;
  remoteJid?: string | null;
  model?: string;
  reviewReasons?: string[];
}): Promise<ProcessAgentTurnV2Result> {
  const now = new Date().toISOString();
  const remoteJid = params.remoteJid?.trim() || `simulation:${params.agentId}`;
  const job: AgentResponseJobRow = {
    id: `simulation:${crypto.randomUUID()}`,
    tenant_id: params.tenantId,
    lead_id: null,
    journey_id: null,
    rule_id: null,
    remote_jid: remoteJid,
    agent_id: params.agentId,
    instance_name: "simulation",
    channel: "evolution",
    connection_id: null,
    status: "processing",
    first_message_at: now,
    last_message_at: now,
    scheduled_for: now,
    max_wait_until: now,
    message_ids: ["simulation-message"],
    inbound_message_count: 1,
    attempt_count: 0,
    burst_generation: 1,
    conversation_sequence: 0,
    provider_first_message_at: now,
    provider_last_message_at: now,
    is_late_fragment: false,
    locked_at: now,
    claim_token: null,
    claim_expires_at: null,
    completed_at: null,
    failed_reason: null,
    created_at: now,
    updated_at: now,
  };
  return processAgentTurnV2({
    sb: params.sb,
    job,
    generation: 1,
    inbound: [
      {
        id: "simulation-message",
        content: params.message,
        kind: "text",
        messageId: "simulation-message",
      },
    ],
    metadata: params.agent as Record<string, unknown>,
    reviewReasons: params.reviewReasons,
    storedResponseMode: params.agent.responseMode,
    storedVoiceId: params.agent.voiceId,
    transport: {
      channel: "evolution",
      slotIndex: 0,
      deliverPrimary: async () => {
        throw new Error("dry_run_transport_must_not_send");
      },
    },
    dryRun: true,
    agentOverride: params.agent,
    model: params.model,
  });
}
