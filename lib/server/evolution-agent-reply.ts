import {
  generateAgentResponse,
  isAgentMissingInstructionsResult,
} from "@/lib/ai/generate-agent-response";
import {
  agendaPlanFromResult,
  type AgentAgendaPlan,
} from "@/lib/ai/agent-turn-plan";
import {
  detectSupportedLanguageCode,
  resolveConfiguredLanguageCode,
  type SupportedLanguageCode,
} from "@/lib/ai/language-detect";
import { localizedAgentFailureReply } from "@/lib/agents/agent-failure-reply";
import {
  canUseTts,
  resolveAgentResponseSettingsFromStorage,
  resolveTriggeringInboundKind,
} from "@/lib/agents";
import { smartWaitFromMetadata } from "@/lib/agents/smart-wait-settings";
import { buildReplyUnitPrompt, normalizeConversationBurst } from "@/lib/conversas/normalize-conversation-burst";
import { shouldSuppressLateInboundFragment } from "@/lib/conversas/late-inbound-fragment";
import {
  isWithinProviderBurstWindow,
  mergeProviderBurstRows,
  PROVIDER_BURST_FORWARD_MS,
  PROVIDER_BURST_LAST_LOOK_MS,
  PROVIDER_BURST_LOOKBACK_MS,
  resolveProviderBurstAnchorMs,
} from "@/lib/conversas/provider-burst-absorb";

/**
 * Texto do lead consolidado na ordem original da unidade. O orquestrador de
 * agenda precisa ler o burst inteiro ("Pode ser hoje as" + "duas da tarde"),
 * não apenas a última mensagem — fragmentos isolados perdem o contexto.
 */
function consolidatedInboundTextFromUnit(unit: { content: string }[]): string {
  return unit
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join("\n");
}

/** Janela segura de contexto inbound entre jobs (evita reusar contexto antigo). */
const RECENT_CLIENT_CONTEXT_WINDOW_MS = 30 * 60 * 1000;
const RECENT_CLIENT_CONTEXT_MAX = 8;

/**
 * Mensagens inbound recentes do lead (role "user"), em ordem temporal, dentro
 * de uma janela segura. Já vêm filtradas por tenant+journey pelo chamador —
 * nunca cruzam conversa/jornada. Usadas só como fonte de âncora de data para
 * complementos que chegaram em turnos anteriores.
 */
export function extractRecentClientMessages(
  messages: Array<{ role: string; content: string; createdAt?: string }>,
): string[] {
  const cutoff = Date.now() - RECENT_CLIENT_CONTEXT_WINDOW_MS;
  const recent = messages
    .filter((m) => m.role === "user" && m.content.trim())
    .filter((m) => {
      if (!m.createdAt) return true;
      const t = Date.parse(m.createdAt);
      return Number.isNaN(t) || t >= cutoff;
    })
    .map((m) => m.content.trim());
  return recent.slice(-RECENT_CLIENT_CONTEXT_MAX);
}
import { detectOutboundRepetition } from "@/lib/conversas/outbound-repetition-guard";
import { isElevenlabsConfigured } from "@/lib/integrations/elevenlabs";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { extractEvolutionSendReceipt } from "@/lib/integrations/evolution-message-receipt";
import { deliverAgentReplyWithOptionalTts } from "@/lib/server/agent-tts-outbound";
import { promoteLeadToContatoOnAgentEngagement } from "@/lib/server/crm-lead-lifecycle";
import { resolveOutboundMediaForAgentResponse } from "@/lib/server/agent-media-files";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import {
  isAgentConversationSequenceCurrent,
  type AgentResponseJobRow,
} from "@/lib/server/agent-response-jobs";
import {
  buildDeterministicHandoffSummary,
  getRecentConversationMessages,
  saveConversationSummary,
  shouldTriggerHandoff,
  shouldTriggerHandoffAI,
} from "@/lib/server/conversation-memory";
import { markWaitingForHuman } from "@/lib/server/conversation-operation";
import { scheduleRetomadaJob } from "@/lib/server/follow-up-jobs";
import { isStaleBurstGenerationRow, sleep } from "@/lib/server/agent-response-schedule";
import { sendAgentOutboundMediaViaEvolution } from "@/lib/server/send-agent-outbound-media-evolution";
import {
  markAgentOutboundFailed,
  markAgentOutboundSent,
  prepareAgentOutbound,
} from "@/lib/server/agent-outbound-outbox";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  describeImageFromBuffer,
  transcribeAudioFromBuffer,
} from "@/lib/ai/media-processor";
import { getMediaBufferFromR2 } from "@/lib/integrations/r2-storage";
import { sendPresence, typingDelayMs } from "@/lib/server/evolution-presence";
import { resolveAgentTimezone } from "@/lib/agents/agent-datetime";
import {
  AGENDA_AUTOMATION_DISABLED_REPLY,
  priorAgendaAssistantTextFromMessages,
  resolveAgendaTurn,
  shouldDeferHandoffForAgendaResult,
} from "@/lib/server/agent-cta-scheduler";
import type { AgentFollowUpInteligente } from "@/lib/types";
import {
  authorizeActiveJourney,
  isJourneyIsolationEnabled,
  touchLeadJourney,
} from "@/lib/server/lead-journeys";
import { scheduleLeadRedistribution } from "@/lib/server/lead-redistribution";
import { getEvolutionInstanceByName } from "@/lib/server/tenant-evolution-instance-db";

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

type GeneratedReplyForUnit =
  | { ok: true; text: string; agendaPlan: AgentAgendaPlan | null }
  | { ok: false; error: "agent_missing_instructions" };

async function saveOutboundMessage(opts: {
  tenantId: string;
  instanceName: string;
  remoteJid: string;
  kind: "text" | "audio";
  content: string;
  agentId: string;
  leadId?: string | null;
  journeyId?: string | null;
  mediaUrl?: string | null;
  providerPayload?: unknown;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const receipt = extractEvolutionSendReceipt(opts.providerPayload);
  const instance = await getEvolutionInstanceByName(opts.instanceName);
  await sb.from("whatsapp_messages").insert({
    tenant_id: opts.tenantId,
    remote_jid: opts.remoteJid,
    direction: "outbound",
    kind: opts.kind,
    content: opts.content,
    agent_id: opts.agentId,
    lead_id: opts.leadId ?? null,
    journey_id: opts.journeyId ?? null,
    media_url: opts.mediaUrl ?? null,
    channel: "evolution",
    connection_id: instance?.id ?? null,
    provider_message_id: receipt.messageId,
    provider_remote_jid: receipt.remoteJid,
    provider_status: receipt.providerStatus,
    delivery_status: receipt.deliveryStatus,
  });
}

async function isGenerationStale(
  sb: SupabaseServiceClient,
  jobId: string,
  claimedGeneration: number,
): Promise<boolean> {
  const { data } = await sb
    .from("agent_response_jobs")
    .select("burst_generation, status")
    .eq("id", jobId)
    .maybeSingle();
  return isStaleBurstGenerationRow(
    data as { burst_generation?: number; status?: string } | null,
    claimedGeneration,
  );
}

function logFollowUp(event: string, payload: Record<string, unknown>): void {
  console.info("[agent-response-jobs]", { event, ...payload });
}

async function generateReplyForUnit(params: {
  job: AgentResponseJobRow;
  unit: import("@/lib/conversas/inbound-message-dedupe").InboundTextMessage[];
  burst: ReturnType<typeof normalizeConversationBurst>;
  suppressedHistoryIds: string[];
  sb: SupabaseServiceClient;
  /** Sobrescreve o prompt calculado via buildReplyUnitPrompt. Usado para passar
   *  burst.userPrompt quando todas as mensagens estão numa única unidade. */
  promptOverride?: string;
  schedulingContextBlock?: string;
}): Promise<GeneratedReplyForUnit> {
  const unitPrompt = params.promptOverride ?? buildReplyUnitPrompt(params.unit);
  const languageCode = detectSupportedLanguageCode(unitPrompt);
  const unitIds = new Set(params.unit.map((m) => m.id));
  const excludeMessageIds = params.suppressedHistoryIds.filter((id) => !unitIds.has(id));

  const result = await generateAgentResponse({
    tenantId: params.job.tenant_id,
    agentId: params.job.agent_id,
    conversationId: params.job.remote_jid,
    journeyId: params.job.journey_id,
    customerId: params.job.remote_jid,
    feature: "agent_chat",
    messages: unitPrompt ? [{ role: "user", content: unitPrompt }] : [],
    excludeMessageIds,
    burstContext: {
      groupedIntent: params.burst.signals.groupedIntent,
      urgencyLevel: params.burst.signals.urgencyLevel,
      responseStrategy: params.burst.responseStrategy,
      dominantIntent: params.burst.signals.dominantIntent,
    },
    schedulingContextBlock: params.schedulingContextBlock,
  });

  if (isAgentMissingInstructionsResult(result)) {
    return { ok: false, error: "agent_missing_instructions" };
  }

  let replyText = result.ok
    ? result.text
    : localizedAgentFailureReply(languageCode);

  let agendaPlan = agendaPlanFromResult(result);
  if (result.ok) {
    const recentOutbound = (
      await getRecentConversationMessages({
        sb: params.sb,
        tenantId: params.job.tenant_id,
        remoteJid: params.job.remote_jid,
        limit: 8,
        journeyId: params.job.journey_id,
      })
    )
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .slice(-3);
    const repeated = detectOutboundRepetition(replyText, recentOutbound);
    if (repeated) {
      const retry = await generateAgentResponse({
        tenantId: params.job.tenant_id,
        agentId: params.job.agent_id,
        conversationId: params.job.remote_jid,
        journeyId: params.job.journey_id,
        customerId: params.job.remote_jid,
        feature: "agent_chat",
        messages: [
          { role: "user", content: unitPrompt },
          {
            role: "user",
            content: "Reescreva sem repetir frases ou CTAs já usadas nas últimas respostas.",
          },
        ],
        excludeMessageIds,
        burstContext: {
          groupedIntent: params.burst.signals.groupedIntent,
          urgencyLevel: params.burst.signals.urgencyLevel,
          responseStrategy: params.burst.responseStrategy,
          dominantIntent: params.burst.signals.dominantIntent,
        },
        schedulingContextBlock: params.schedulingContextBlock,
        externalApiLookups: false,
      });
      if (retry.ok) {
        replyText = retry.text;
        agendaPlan = agendaPlanFromResult(retry);
      }
    }
  }

  return { ok: true, text: replyText, agendaPlan };
}

export async function processAgentResponseJob(
  sb: SupabaseServiceClient,
  job: AgentResponseJobRow,
  claimedGeneration?: number,
  options?: { skipGenerationCheck?: boolean },
): Promise<{ ok: true; dedupedCount: number } | { ok: false; error: string; dedupedCount?: number }> {
  const generation = claimedGeneration ?? job.burst_generation;
  const skipGenerationCheck = options?.skipGenerationCheck === true;
  if (!skipGenerationCheck && !(await isAgentConversationSequenceCurrent(sb, job))) {
    return { ok: false, error: "generation_stale", dedupedCount: 0 };
  }

  if (isJourneyIsolationEnabled()) {
    const journeyAuth = job.journey_id
      ? await authorizeActiveJourney({
          sb,
          tenantId: job.tenant_id,
          remoteJid: job.remote_jid,
          preferredAgentId: job.agent_id,
        })
      : null;
    if (!job.journey_id || !journeyAuth?.ok || journeyAuth.journey?.id !== job.journey_id) {
      const reason =
        !job.journey_id
          ? "missing_active_journey"
          : journeyAuth?.ok
            ? "journey_id_mismatch"
            : journeyAuth?.reason ?? "journey_not_authorized";
      await sb
        .from("agent_response_jobs")
        .update({
          status: "cancelled",
          failed_reason: reason,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (
        job.journey_id &&
        journeyAuth &&
        !journeyAuth.ok &&
        journeyAuth.journey?.ruleId &&
        journeyAuth.reason === "journey_agent_inactive"
      ) {
        await scheduleLeadRedistribution({
          sb,
          tenantId: job.tenant_id,
          journeyId: job.journey_id,
          ruleId: journeyAuth.journey.ruleId,
          currentAgentId: job.agent_id,
          trigger: "agent_unavailable",
        });
      }
      return { ok: false, error: reason, dedupedCount: 0 };
    }
  }

  const autoContactGuard = await canAgentAutoContactLead({
    sb,
    tenantId: job.tenant_id,
    agentId: job.agent_id,
    leadId: job.lead_id,
    phone: job.remote_jid,
    remoteJid: job.remote_jid,
    journeyId: job.journey_id,
    triggerSource: "agent_response_job",
  });
  if (!autoContactGuard.ok) {
    await sb
      .from("agent_response_jobs")
      .update({
        status: "cancelled",
        failed_reason: autoContactGuard.reason,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.warn("[agent-response-jobs] auto contact blocked", {
      job_id: job.id,
      tenant_id: job.tenant_id,
      agent_id: job.agent_id,
      lead_id: autoContactGuard.leadId,
      form_id: autoContactGuard.formId,
      reason: autoContactGuard.reason,
    });
    return { ok: false, error: autoContactGuard.reason, dedupedCount: 0 };
  }

  // Bug 1 fix: add 1ms buffer to last_message_at to compensate for JS Date microsecond
  // truncation. PostgreSQL stores created_at with µs precision (e.g. "14:15:51.051645");
  // JS toISOString() truncates to ms ("14:15:51.051"), causing .lte() to exclude the last
  // message of every burst. Adding 1ms ensures the filter covers the full window.
  const windowEnd = new Date(new Date(job.last_message_at).getTime() + 1).toISOString();
  let windowQuery = sb
    .from("whatsapp_messages")
    .select("id, content, kind, message_id, remote_jid, created_at, received_at, conversation_sequence, is_late_fragment, storage_key, mime_type, analysis_status, ai_description")
    .eq("tenant_id", job.tenant_id)
    .eq("remote_jid", job.remote_jid)
    .eq("direction", "inbound")
    .gte("received_at", job.first_message_at)
    .lte("received_at", windowEnd);
  if (job.journey_id) windowQuery = windowQuery.eq("journey_id", job.journey_id);
  const { data: rowsByWindow, error: windowError } = await windowQuery.order("received_at", {
    ascending: true,
  });
  if (windowError) return { ok: false, error: windowError.message };

  let inboundRows = (rowsByWindow ?? []) as PendingInboundRow[];
  // Bug 2 fix: fallback also triggers when window returns partial results (N-1 instead of N).
  // Previously only fired on zero results, silently processing incomplete bursts.
  if (inboundRows.length < job.message_ids.length && job.message_ids.length > 0) {
    const existingIds = new Set(inboundRows.map((r) => r.id));
    const missingIds = job.message_ids.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      const { data: rowsById, error } = await sb
        .from("whatsapp_messages")
        .select("id, content, kind, message_id, remote_jid, created_at, received_at, conversation_sequence, is_late_fragment, storage_key, mime_type, analysis_status, ai_description")
        .eq("tenant_id", job.tenant_id)
        .eq("remote_jid", job.remote_jid)
        .eq("direction", "inbound")
        .in("id", missingIds)
        .order("received_at", { ascending: true });
      if (error) return { ok: false, error: error.message };
      const missing = (rowsById ?? []) as PendingInboundRow[];
      inboundRows = [...inboundRows, ...missing].sort(
        (a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime(),
      );
    }
  }
  if (!inboundRows.length) return { ok: false, error: "no_inbound_messages" };

  // Last-look: dá tempo para o webhook da Evolution inserir o complemento do
  // mesmo burst (metrônomo ~60s) antes de fechar o contexto do turno.
  await sleep(PROVIDER_BURST_LAST_LOOK_MS);

  const providerAnchorMs = resolveProviderBurstAnchorMs({
    providerFirstMessageAt: job.provider_first_message_at,
    inboundRows,
  });
  if (providerAnchorMs != null) {
    const providerFrom = new Date(providerAnchorMs - PROVIDER_BURST_LOOKBACK_MS).toISOString();
    const providerTo = new Date(providerAnchorMs + PROVIDER_BURST_FORWARD_MS).toISOString();
    let providerQuery = sb
      .from("whatsapp_messages")
      .select(
        "id, content, kind, message_id, remote_jid, created_at, received_at, conversation_sequence, is_late_fragment, storage_key, mime_type, analysis_status, ai_description",
      )
      .eq("tenant_id", job.tenant_id)
      .eq("remote_jid", job.remote_jid)
      .eq("direction", "inbound")
      .gte("created_at", providerFrom)
      .lte("created_at", providerTo);
    if (job.journey_id) providerQuery = providerQuery.eq("journey_id", job.journey_id);
    const { data: providerRows, error: providerError } = await providerQuery.order("created_at", {
      ascending: true,
    });
    if (!providerError && providerRows?.length) {
      const beforeCount = inboundRows.length;
      const absorbed = (providerRows as PendingInboundRow[]).filter((row) =>
        isWithinProviderBurstWindow(providerAnchorMs, row.created_at),
      );
      inboundRows = mergeProviderBurstRows(inboundRows, absorbed);
      if (inboundRows.length > beforeCount) {
        console.info("[agent-response-jobs]", {
          event: "provider_burst_absorbed",
          job_id: job.id,
          added: inboundRows.length - beforeCount,
          total: inboundRows.length,
        });
      }
    }
  }

  const lateSuppressed = inboundRows.filter((row) =>
    shouldSuppressLateInboundFragment({
      isLateFragment: row.is_late_fragment,
      kind: row.kind,
      content: row.content,
    }),
  );
  if (lateSuppressed.length > 0) {
    const suppressedIds = new Set(lateSuppressed.map((row) => row.id));
    inboundRows = inboundRows.filter((row) => !suppressedIds.has(row.id));
    console.info("[agent-response-jobs]", {
      event: "late_fragment_suppressed",
      job_id: job.id,
      count: lateSuppressed.length,
    });
    if (!inboundRows.length) {
      return { ok: true, dedupedCount: lateSuppressed.length };
    }
  }

  // ── Transcrição de áudio via R2 ──────────────────────────────────────────
  // O webhook (Phase 1) já salva o áudio no R2 (storage_key em whatsapp_messages).
  // O fire-and-forget para /api/internal/transcribe-audio nunca chega a ser
  // executado pelo Vercel (a função retorna antes de a conexão TCP ser aberta).
  // Aqui, lemos directamente o buffer do R2 e chamamos o Whisper — sem depender
  // do rawNode original nem de qualquer endpoint externo.
  const pendingAudio = inboundRows.filter(
    (r) => r.kind === "audio" && r.content === "[Áudio]",
  );

  if (pendingAudio.length > 0) {
    console.info("[agent-response-jobs]", {
      event: "transcribing_audio_from_r2",
      job_id: job.id,
      pending_count: pendingAudio.length,
    });

    for (const audioRow of pendingAudio) {
      if (!audioRow.storage_key) {
        console.warn("[agent-response-jobs] áudio sem storage_key — não é possível transcrever", {
          job_id: job.id,
          message_id: audioRow.id,
        });
        continue;
      }
      try {
        const audioBuffer = await getMediaBufferFromR2(audioRow.storage_key);
        const mimetype = audioRow.mime_type || "audio/ogg";
        const transcript = await transcribeAudioFromBuffer(audioBuffer, mimetype);
        if (transcript) {
          audioRow.content = transcript;
          await sb
            .from("whatsapp_messages")
            .update({ content: transcript, transcription_status: "completed" })
            .eq("id", audioRow.id);
          console.info("[agent-response-jobs]", {
            event: "audio_transcription_ok",
            job_id: job.id,
            message_id: audioRow.id,
            transcript_length: transcript.length,
          });
        } else {
          await sb
            .from("whatsapp_messages")
            .update({ transcription_status: "failed" })
            .eq("id", audioRow.id);
          console.warn("[agent-response-jobs]", {
            event: "audio_transcription_failed",
            job_id: job.id,
            message_id: audioRow.id,
          });
        }
      } catch (err) {
        console.warn(
          "[agent-response-jobs] transcription error",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  // ── Fim da transcrição de áudio ───────────────────────────────────────────

  // ── Análise visual via R2 ──────────────────────────────────────────────────
  // O Smart Wait não possui mais o rawNode do webhook. A imagem já foi
  // arquivada na Phase 1; analisá-la aqui garante que o turno agrupado receba
  // os pixels reais, inclusive quando há legenda/complemento em outra mensagem.
  const inboundImages = inboundRows.filter((row) => row.kind === "image");
  for (const imageRow of inboundImages) {
    let description =
      imageRow.analysis_status === "completed" ? imageRow.ai_description?.trim() || null : null;
    if (!description && imageRow.storage_key) {
      try {
        const imageBuffer = await getMediaBufferFromR2(imageRow.storage_key);
        description = await describeImageFromBuffer(
          imageBuffer,
          imageRow.mime_type || "image/jpeg",
        );
        if (description) {
          await sb
            .from("whatsapp_messages")
            .update({ analysis_status: "completed", ai_description: description })
            .eq("id", imageRow.id);
          imageRow.analysis_status = "completed";
          imageRow.ai_description = description;
          console.info("[agent-response-jobs]", {
            event: "image_analysis_ok",
            job_id: job.id,
            message_id: imageRow.id,
          });
        }
      } catch (err) {
        console.warn(
          "[agent-response-jobs] image analysis error",
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (!description) {
      await sb
        .from("whatsapp_messages")
        .update({ analysis_status: "failed" })
        .eq("id", imageRow.id);
      imageRow.content = `${imageRow.content}\n[Não foi possível analisar os detalhes visuais; peça ao cliente que confirme por texto.]`;
      continue;
    }
    const caption = imageRow.content
      .replace(/^\s*\[(?:imagem|image)\]\s*$/i, "")
      .trim();
    imageRow.content = [caption, "[Análise visual]", description].filter(Boolean).join("\n");
  }
  // ── Fim da análise visual ──────────────────────────────────────────────────

  const { data: agentRow } = await sb
    .from("tenant_agents")
    .select("metadata, voice_id, response_mode")
    .eq("tenant_id", job.tenant_id)
    .eq("agent_id", job.agent_id)
    .maybeSingle();
  const metadata =
    agentRow?.metadata && typeof agentRow.metadata === "object"
      ? (agentRow.metadata as Record<string, unknown>)
      : {};
  const smartWait = smartWaitFromMetadata(metadata);
  const burstMode =
    metadata.smartWaitBurstMode === "exact" ? "exact" as const : "relaxed" as const;

  const burst = normalizeConversationBurst(
    inboundRows.map((row) => ({
      id: row.id,
      content: row.content,
      messageId: row.message_id,
      kind: row.kind,
    })),
    { dedupeEnabled: smartWait.dedupeRepeated, burstMode },
  );

  console.info("[agent-response-jobs]", {
    event: "grouped_messages_count",
    job_id: job.id,
    count: burst.groupedMessagesCount,
  });
  console.info("[agent-response-jobs]", {
    event: "deduped_messages_count",
    job_id: job.id,
    count: burst.dedupedCount,
  });
  console.info("[agent-response-jobs]", {
    event: "grouped_intent",
    job_id: job.id,
    intent: burst.signals.groupedIntent,
    dominant: burst.signals.dominantIntent,
  });
  console.info("[agent-response-jobs]", {
    event: "urgency_level",
    job_id: job.id,
    level: burst.signals.urgencyLevel,
  });
  console.info("[agent-response-jobs]", {
    event: "response_strategy",
    job_id: job.id,
    strategy: burst.responseStrategy,
  });

  console.info("[agent-response-jobs]", {
    event: "reply_units_count",
    job_id: job.id,
    count: burst.canonicalMessages.length > 0 ? 1 : 0,
  });

  const handoffKeywords = Array.isArray(metadata.handoffKeywords)
    ? metadata.handoffKeywords.filter((item): item is string => typeof item === "string")
    : [];
  const handoffEnabled = metadata.ctaHandoffAtivo === true;
  const schedulingTimezone = resolveAgentTimezone({
    timezone: typeof metadata.timezone === "string" ? metadata.timezone : undefined,
    followUpInteligente: metadata.followUpInteligente as AgentFollowUpInteligente | undefined,
  });
  const handoffMessage =
    handoffEnabled && typeof metadata.handoffMensagem === "string" && metadata.handoffMensagem.trim()
      ? metadata.handoffMensagem.trim()
      : null;

  const number = remoteJidToEvoNumber(job.remote_jid);
  if (!number) return { ok: false, error: "invalid_remote_jid", dedupedCount: burst.dedupedCount };

  // Se TODOS os inbounds são áudio e NENHUM foi transcrito, enviar mensagem de apologia
  // em vez de passar "[Áudio]" para o modelo (que responderia "não posso processar áudio").
  const allAudioUntranscribed =
    inboundRows.length > 0 &&
    inboundRows.every((r) => r.kind === "audio" && r.content === "[Áudio]");

  if (allAudioUntranscribed) {
    const apology =
      "Desculpe, não consegui processar seu áudio. Pode digitar sua mensagem?";
    const outbound = await prepareAgentOutbound({
      sb,
      job,
      generation,
      kind: "text",
      content: apology,
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
    if (!(await isAgentConversationSequenceCurrent(sb, job))) {
      return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
    }
    await sendPresence(job.instance_name, number, "composing", typingDelayMs(apology));
    const apologyResult = await evolutionSendText({
      instanceName: job.instance_name,
      number,
      text: apology,
      resolveRecipient: true,
    });
    if (apologyResult.ok) {
      const receipt = extractEvolutionSendReceipt(apologyResult.data);
      await markAgentOutboundSent({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        providerMessageId: receipt.messageId,
        job,
      });
      await saveOutboundMessage({
        tenantId: job.tenant_id,
        instanceName: job.instance_name,
        remoteJid: job.remote_jid,
        kind: "text",
        content: apology,
        agentId: job.agent_id,
        leadId: job.lead_id,
        journeyId: job.journey_id,
        providerPayload: apologyResult.data,
      });
    } else {
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: apologyResult.error ?? "audio_transcription_apology_send_failed",
      });
      return { ok: false, error: "outbound_send_failed", dedupedCount: burst.dedupedCount };
    }
    console.info("[agent-response-jobs]", {
      event: "audio_transcription_apology_sent",
      job_id: job.id,
    });
    return { ok: true, dedupedCount: burst.dedupedCount };
  }

  // Burst misto (texto + áudio não transcrito): substitui placeholder para
  // o modelo receber contexto parcial em vez de texto literal "[Áudio]".
  for (const row of inboundRows) {
    if (row.kind === "audio" && row.content === "[Áudio]") {
      row.content = "[Áudio não transcrito]";
    }
  }

  const { responseMode, voiceId } = resolveAgentResponseSettingsFromStorage({
    response_mode: agentRow?.response_mode,
    voice_id: agentRow?.voice_id,
    metadata: agentRow?.metadata,
  });
  const triggeringMessageId = job.message_ids[job.message_ids.length - 1] ?? null;
  const triggeringInboundKind = resolveTriggeringInboundKind(inboundRows, triggeringMessageId);
  const elevenLabsAvailable = isElevenlabsConfigured();

  let handoffTriggered = false;
  let handoffReason: string | undefined;
  let handoffLastMessage: string | undefined;
  let repliesSent = 0;

  const unitIndex = 0;
  const unit = burst.canonicalMessages;
  if (!unit.length) {
    return { ok: false, error: "no_canonical_inbound_messages", dedupedCount: burst.dedupedCount };
  }
  if (
    !skipGenerationCheck &&
    ((await isGenerationStale(sb, job.id, generation)) ||
      !(await isAgentConversationSequenceCurrent(sb, job)))
  ) {
    return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
  }

    const unitPrompt = buildReplyUnitPrompt(unit);
    // AI-based detection: universal, nicho-agnóstica, com fallback automático para keywords
    const handoffCheck = handoffEnabled
      ? await shouldTriggerHandoffAI(unitPrompt, handoffKeywords)
      : { trigger: false, reason: null };
    const generatedReply = await generateReplyForUnit({
      job,
      unit,
      burst,
      suppressedHistoryIds: burst.suppressedHistoryIds,
      sb,
      // A consolidação preserva texto, idioma e ordem; o prompt do cliente
      // continua sendo a única fonte de comportamento do agente.
      promptOverride: burst.userPrompt,
    });

    if (!generatedReply.ok) {
      console.warn("[agent-response-jobs] automatic reply blocked because agent has no instructions", {
        job_id: job.id,
        tenant_id: job.tenant_id,
        agent_id: job.agent_id,
        journey_id: job.journey_id,
      });
      return {
        ok: false,
        error: generatedReply.error,
        dedupedCount: burst.dedupedCount,
      };
    }
    const replyText = generatedReply.text;

    console.info("[agent-response-jobs]", {
      event: "generated_response",
      job_id: job.id,
      unit_index: unitIndex + 1,
      units_total: 1,
      ok: true,
    });

    // Primary: keyword-based detection on user's message
    if (handoffCheck.trigger) {
      handoffTriggered = true;
      handoffReason = handoffCheck.reason ?? "handoff";
      handoffLastMessage = unitPrompt;
    }
    // Strip [[HANDOFF]] marker from AI reply (always safe to remove)
    const aiMarkerHandoff = handoffEnabled && replyText.includes("[[HANDOFF]]");
    const modelTextWithoutHandoff = replyText.replace(/\[\[HANDOFF\]\]/gi, "").trim();
    const recentConversation = await getRecentConversationMessages({
      sb,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      limit: 12,
      journeyId: job.journey_id,
    });
    const priorAssistantText = priorAgendaAssistantTextFromMessages(
      recentConversation,
      schedulingTimezone,
    );
    // Contexto inbound recente do lead (mesma conversa/jornada, janela segura):
    // permite resolver complementos que chegaram em jobs anteriores (data num
    // turno, hora no seguinte) sem inventar horário nem cruzar tenant/jornada.
    const recentClientMessages = extractRecentClientMessages(recentConversation);
    // Barreira final de staleness ANTES da mutação de agenda: se chegou mensagem
    // mais nova durante a inferência, esta geração não pode alterar a agenda nem
    // notificar — o job re-agendado (generation nova) processa o contexto completo.
    if (!skipGenerationCheck && (await isGenerationStale(sb, job.id, generation))) {
      return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
    }
    const agendaTurn = await resolveAgendaTurn({
      sb,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      leadId: job.lead_id,
      agentId: job.agent_id,
      timezone: schedulingTimezone,
      modelText: modelTextWithoutHandoff,
      agendaPlan: generatedReply.agendaPlan,
      clientText: consolidatedInboundTextFromUnit(unit),
      languageCode: resolveConfiguredLanguageCode(
        typeof metadata.idioma === "string" ? metadata.idioma : null,
        consolidatedInboundTextFromUnit(unit),
      ),
      priorAssistantText,
      recentClientMessages,
      agendaAutomationEnabled: metadata.agendaAutomationEnabled === true,
      ctaHandoffAtivo: metadata.ctaHandoffAtivo === true,
      agendaLembretes:
        typeof metadata.agendaLembretes === "object" && metadata.agendaLembretes !== null
          ? (metadata.agendaLembretes as import("@/lib/types").AgentAgendaLembretes)
          : null,
      agendaDisponibilidade:
        typeof metadata.agendaDisponibilidade === "object" && metadata.agendaDisponibilidade !== null
          ? (metadata.agendaDisponibilidade as import("@/lib/types").AgentAgendaDisponibilidade)
          : null,
      slotIndex: typeof metadata.whatsappSlotIndex === "number" ? metadata.whatsappSlotIndex : 0,
      operationKey: `agent-response-job:${job.id}:${generation}:${unitIndex}`,
      jobId: skipGenerationCheck ? null : job.id,
      claimedGeneration: skipGenerationCheck ? null : generation,
      conversationSequence: skipGenerationCheck ? null : job.conversation_sequence,
      journeyId: skipGenerationCheck ? null : (job.journey_id ?? null),
    });
    // Recusa atômica de staleness pela RPC: a geração foi superada entre o check
    // e a mutação. Zero efeito colateral aconteceu — abortar sem enviar nada; o
    // job re-agendado (geração nova) responde ao contexto atual.
    if (agendaTurn.action === "stale") {
      return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
    }
    if (agendaTurn.action === "blocked" || agendaTurn.action === "failed") {
      console.info("[agent-agenda-turn]", {
        tenant_id: job.tenant_id,
        agent_id: job.agent_id,
        action: agendaTurn.action,
      });
    }
    const preparedAgendaResponseText =
      agendaTurn.action === "blocked" ? AGENDA_AUTOMATION_DISABLED_REPLY : agendaTurn.text;

    // Secondary: LLM included [[HANDOFF]] marker (catches "alta intenção" cases
    // where keywords don't match but LLM correctly decided to transfer)
    if (aiMarkerHandoff && !handoffTriggered) {
      handoffTriggered = true;
      handoffReason = "ai_handoff";
      handoffLastMessage = unitPrompt;
    }
    if (shouldDeferHandoffForAgendaResult(agendaTurn)) {
      handoffTriggered = false;
      handoffReason = undefined;
      handoffLastMessage = undefined;
    }

    const outboundMediaParse = await resolveOutboundMediaForAgentResponse({
      sb,
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      responseText: preparedAgendaResponseText,
      userRequestText: unitPrompt,
    });
    const outboundFilenames = outboundMediaParse.filenames;
    let textToSend = outboundMediaParse.cleanedText.trim();
    if (handoffTriggered && handoffMessage) {
      textToSend = handoffMessage;
    }
    if (agendaTurn.action === "blocked") {
      textToSend = AGENDA_AUTOMATION_DISABLED_REPLY;
    } else if (agendaTurn.action === "failed") {
      textToSend = agendaTurn.text;
    }
    if (!textToSend && outboundFilenames.length) {
      textToSend = "Segue o envio solicitado.";
    }
    console.info("[evolution-agent-reply]", {
      event: "outbound_media_resolved",
      job_id: job.id,
      filenames_count: outboundFilenames.length,
      inferred: outboundMediaParse.inferred,
    });

    const sendOutboundMediaSafe = async (): Promise<void> => {
      if (!outboundFilenames.length) return;
      try {
        await sendAgentOutboundMediaViaEvolution({
          tenantId: job.tenant_id,
          agentId: job.agent_id,
          instanceName: job.instance_name,
          number,
          originalFilenames: outboundFilenames,
          remoteJid: job.remote_jid,
          journeyId: job.journey_id!,
          connectionId: job.connection_id!,
          operationKeyPrefix: `agent-response:${job.id}:${generation}`,
          leadId: job.lead_id,
        });
      } catch (err) {
        console.warn(
          "[agent-response-jobs] outbound agent media",
          err instanceof Error ? err.message : err,
        );
      }
    };

    const languageCode = detectSupportedLanguageCode(unitPrompt);
    const useTts = canUseTts({
      agentResponseMode: responseMode,
      inboundKind: triggeringInboundKind,
      voiceId,
      elevenLabsAvailable,
      handoffTriggered,
    });

    console.info("[agent-response-jobs]", {
      event: "response_mode_decision",
      job_id: job.id,
      unit_index: unitIndex + 1,
      response_mode: responseMode,
      triggering_message_id: triggeringMessageId,
      triggering_inbound_kind: triggeringInboundKind,
      elevenlabs_available: elevenLabsAvailable,
      use_tts: useTts,
    });

    if (useTts) {
      await sendPresence(job.instance_name, number, "recording", 3000);
    } else {
      await sendPresence(job.instance_name, number, "composing", typingDelayMs(textToSend));
    }

    if (isJourneyIsolationEnabled()) {
      const currentJourney = await authorizeActiveJourney({
        sb,
        tenantId: job.tenant_id,
        remoteJid: job.remote_jid,
        preferredAgentId: job.agent_id,
      });
      if (!currentJourney.ok || currentJourney.journey?.id !== job.journey_id) {
        return {
          ok: false,
          error: currentJourney.ok ? "journey_superseded_before_send" : currentJourney.reason,
          dedupedCount: burst.dedupedCount,
        };
      }
    }

    // Barreira final de staleness ANTES do envio: uma resposta obsoleta nunca
    // chega ao lead — o job com generation nova responde pelo contexto atual.
    if (!skipGenerationCheck && (await isGenerationStale(sb, job.id, generation))) {
      return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
    }

    const outbound = await prepareAgentOutbound({
      sb,
      job,
      generation,
      kind: useTts ? "audio" : "text",
      content: textToSend.slice(0, 4000),
    });
    outboundDispatch: {
      if (outbound.action === "already_sent") {
        repliesSent += 1;
        break outboundDispatch;
      }
      if (outbound.action === "stale") {
        return {
          ok: false,
          error: "generation_stale",
          dedupedCount: burst.dedupedCount,
        };
      }
      if (outbound.action === "blocked") {
        return {
          ok: false,
          error: `authorization_blocked:${outbound.reason}`,
          dedupedCount: burst.dedupedCount,
        };
      }
      if (outbound.action === "ambiguous") {
        return {
          ok: false,
          error: "outbound_dispatch_ambiguous",
          dedupedCount: burst.dedupedCount,
        };
      }
      if (outbound.action === "in_progress") {
        return {
          ok: false,
          error: "outbound_dispatch_in_progress",
          dedupedCount: burst.dedupedCount,
        };
      }

    if (!(await isAgentConversationSequenceCurrent(sb, job))) {
      return { ok: false, error: "generation_stale", dedupedCount: burst.dedupedCount };
    }
    const delivery = await deliverAgentReplyWithOptionalTts({
      instanceName: job.instance_name,
      number,
      text: textToSend,
      voiceId: voiceId!,
      languageCode,
      tenantId: job.tenant_id,
      useTts,
      logScope: "agent-response-jobs",
      logContext: {
        job_id: job.id,
        tenant_id: job.tenant_id,
        agent_id: job.agent_id,
        triggering_inbound_kind: triggeringInboundKind,
      },
      sendText: () =>
        evolutionSendText({
          instanceName: job.instance_name,
          number,
          text: textToSend.slice(0, 4000),
          resolveRecipient: true,
        }),
    });

    if (!delivery.sent) {
      await markAgentOutboundFailed({
        sb,
        id: outbound.id,
        claimToken: outbound.claimToken,
        error: "outbound_send_failed",
      });
      const journey = job.journey_id
        ? await authorizeActiveJourney({
            sb,
            tenantId: job.tenant_id,
            remoteJid: job.remote_jid,
            preferredAgentId: job.agent_id,
          })
        : null;
      await scheduleLeadRedistribution({
        sb,
        tenantId: job.tenant_id,
        journeyId: job.journey_id,
        ruleId: journey?.journey?.ruleId,
        currentAgentId: job.agent_id,
        trigger: "delivery_failed",
      });
      return { ok: false, error: "outbound_send_failed", dedupedCount: burst.dedupedCount };
    }

    const providerReceipt = extractEvolutionSendReceipt(delivery.providerPayload);
    await markAgentOutboundSent({
      sb,
      id: outbound.id,
      claimToken: outbound.claimToken,
      providerMessageId: providerReceipt.messageId,
      job,
    });

    await saveOutboundMessage({
      tenantId: job.tenant_id,
      instanceName: job.instance_name,
      remoteJid: job.remote_jid,
      kind: delivery.channel === "audio" ? "audio" : "text",
      content: textToSend.slice(0, 4000),
      agentId: job.agent_id,
      leadId: job.lead_id,
      journeyId: job.journey_id,
      mediaUrl: delivery.mediaUrl,
      providerPayload: delivery.providerPayload,
    });
    await scheduleLeadRedistribution({
      sb,
      tenantId: job.tenant_id,
      journeyId: job.journey_id,
      ruleId:
        job.journey_id
          ? (
              await authorizeActiveJourney({
                sb,
                tenantId: job.tenant_id,
                remoteJid: job.remote_jid,
                preferredAgentId: job.agent_id,
              })
            ).journey?.ruleId
          : null,
      currentAgentId: job.agent_id,
      trigger: "customer_silence",
    });
    await sendOutboundMediaSafe();

    repliesSent += 1;
    console.info("[agent-response-jobs]", {
      event: "final_outbound_sent",
      job_id: job.id,
      unit_index: unitIndex + 1,
      units_total: 1,
    });
    }

  if (handoffTriggered) {
    const messages = await getRecentConversationMessages({
      sb,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      journeyId: job.journey_id,
    });
    const summary = buildDeterministicHandoffSummary({
      lead: job.lead_id
        ? {
            id: job.lead_id,
            name: null,
            phone: job.remote_jid.split("@")[0]?.replace(/\D/g, "") ?? null,
            source: "whatsapp",
            status: null,
            crmFunnelId: null,
            notes: null,
            agentId: job.agent_id,
            aiSummary: null,
            leadTemperature: null,
            suggestedNextAction: null,
            profileMetadata: {},
          }
        : null,
      messages,
      reason: handoffReason ?? "handoff",
    });
    await saveConversationSummary({
      sb,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      leadId: job.lead_id,
      agentId: job.agent_id,
      journeyId: job.journey_id,
      summary,
    });
    await markWaitingForHuman({
      sb,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      leadId: job.lead_id,
      agentId: job.agent_id,
      reason: handoffReason ?? "handoff",
      handoffNumero: typeof metadata.handoffNumero === "string" ? metadata.handoffNumero : null,
      lastMessage: handoffLastMessage ?? null,
    });

    // Se o agente tem "Retomar só se humano abandonou" configurado, agenda um job
    // futuro para checar o timeout de retomada — evita que o follow-up fique preso
    // indefinidamente após o handoff cancelar todos os jobs pendentes.
    const fuMeta = metadata?.followUpInteligente;
    if (fuMeta && typeof fuMeta === "object") {
      const fu = fuMeta as Record<string, unknown>;
      if (
        fu.ativo === true &&
        fu.retomadaApenasSeHumanoAbandonou === true &&
        typeof fu.retomadaHumanoTempoValor === "number"
      ) {
        const rawValor = fu.retomadaHumanoTempoValor as number;
        const rawUnidade = fu.retomadaHumanoTempoUnidade;
        const unidade =
          rawUnidade === "minutos" || rawUnidade === "dias" ? rawUnidade : "horas";
        const ms =
          unidade === "minutos"
            ? rawValor * 60_000
            : unidade === "dias"
              ? rawValor * 86_400_000
              : rawValor * 3_600_000;
        await scheduleRetomadaJob({
          sb,
          tenantId: job.tenant_id,
          agentId: job.agent_id,
          remoteJid: job.remote_jid,
          leadId: job.lead_id,
          scheduledAt: new Date(Date.now() + ms),
        });
      }
    }
  }

  await promoteLeadToContatoOnAgentEngagement({
    sb,
    tenantId: job.tenant_id,
    leadId: job.lead_id,
  });
  if (job.journey_id) {
    await touchLeadJourney({
      sb,
      tenantId: job.tenant_id,
      journeyId: job.journey_id,
      leadId: job.lead_id,
    });
  }

  console.info("[agent-response-jobs]", {
    event: "consolidated_response_completed",
    job_id: job.id,
    replies_sent: repliesSent,
    units_total: 1,
  });

  return { ok: true, dedupedCount: burst.dedupedCount };
}
