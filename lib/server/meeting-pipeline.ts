import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createR2PresignedGetUrl } from "@/lib/integrations/r2-storage";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { meetingsRealtimeChannel, MEETING_REALTIME_EVENT } from "@/lib/meetings/realtime";
import {
  claimMeetingJobs,
  enqueueMeetingJob,
  finishMeetingJob,
  safeMeetingErrorCode,
  withMeetingJobHeartbeat,
  type MeetingJobRow,
} from "@/lib/server/meeting-jobs";
import {
  assemblyAiProvider,
  resolveProviderForDuration,
  resolveTranscriptionProvider,
  transcriptionWebhookSecret,
  whisperFallbackProvider,
  type NormalizedTranscript,
  type TranscriptionProvider,
} from "@/lib/server/meeting-transcription";
import { runMeetingAnalysis } from "@/lib/server/meeting-analysis";
import { recordMeetingUsage } from "@/lib/server/meeting-quota";
import { buildSearchChunks } from "@/lib/server/meeting-search";
import { embedTexts } from "@/lib/ai/embeddings";
import type { NormalizedSegment } from "@/lib/server/meeting-transcription";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Lote de segmentos por chamada — o mesmo teto declarado na RPC. */
const SEGMENT_BATCH = 500;
/** Presigned GET para o provedor ler o áudio. */
const PROVIDER_AUDIO_URL_TTL_SECONDS = 2 * 3600;

type MeetingRow = {
  id: string;
  tenant_id: string;
  storage_key: string;
  mime_type: string;
  language: string;
  meeting_type: string;
  status: string;
  duration_ms: number | null;
  recorded_at: string | null;
  processing_version: number;
  provider: string | null;
  provider_job_id: string | null;
  user_notes: string;
};

async function loadMeetingRow(
  sb: SupabaseServiceClient,
  tenantId: string,
  meetingId: string,
): Promise<MeetingRow> {
  const { data, error } = await sb
    .from("meetings")
    .select(
      "id, tenant_id, storage_key, mime_type, language, meeting_type, status, duration_ms, recorded_at, processing_version, provider, provider_job_id, user_notes",
    )
    .eq("tenant_id", tenantId)
    .eq("id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) throw new Error("meeting_not_found");
  return data as unknown as MeetingRow;
}

function publicBaseUrl(): string {
  const base =
    process.env.MYCHATCRM_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!base) throw new Error("meeting_public_base_url_missing");
  return base;
}

// ---------------------------------------------------------------------------
// prepare — entrega o áudio ao provedor
// ---------------------------------------------------------------------------

/**
 * Escolhe o provedor da tentativa.
 *
 * A partir da terceira tentativa cai para o Whisper: se o primário falhou duas
 * vezes seguidas, insistir só adia a entrega. O fallback perde a separação de
 * falantes, e a interface mostra isso — degradação visível, nunca silenciosa.
 */
export function providerForAttempt(
  attempt: number,
  durationMs: number | null = null,
): TranscriptionProvider {
  if (attempt >= 3) return whisperFallbackProvider;
  return resolveProviderForDuration(durationMs) ?? assemblyAiProvider;
}

async function runPrepareStage(sb: SupabaseServiceClient, job: MeetingJobRow): Promise<void> {
  const meeting = await loadMeetingRow(sb, job.tenantId, job.meetingId);
  const provider = providerForAttempt(job.attempts, meeting.duration_ms);

  const audioUrl = await createR2PresignedGetUrl({
    key: meeting.storage_key,
    expiresInSeconds: PROVIDER_AUDIO_URL_TTL_SECONDS,
  });

  const submission = await provider.submit({
    audioUrl,
    storageKey: meeting.storage_key,
    mimeType: meeting.mime_type,
    languageCode: meeting.language || "pt",
    webhookUrl: new URL("/api/webhooks/transcription", publicBaseUrl()).toString(),
    webhookSecret: transcriptionWebhookSecret(),
  });

  if (submission.mode === "async") {
    const { error } = await sb
      .from("meetings")
      .update({
        provider: provider.name,
        provider_job_id: submission.providerJobId,
        status: "transcribing",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", job.tenantId)
      .eq("id", job.meetingId);
    if (error) throw new Error("meeting_provider_job_persist_failed");

    await appendOperationalAuditEvent({
      tenantId: job.tenantId,
      actorType: "worker",
      module: "meetings",
      action: "transcription_requested",
      resourceType: "meeting",
      resourceId: job.meetingId,
      status: "running",
      integration: provider.name,
      attempt: job.attempts,
    });
    return;
  }

  // Caminho síncrono (Whisper): já temos o texto, então persiste aqui mesmo.
  await sb
    .from("meetings")
    .update({ provider: provider.name, updated_at: new Date().toISOString() })
    .eq("tenant_id", job.tenantId)
    .eq("id", job.meetingId);

  await persistTranscript(sb, {
    tenantId: job.tenantId,
    meetingId: job.meetingId,
    processingVersion: job.processingVersion,
    providerJobId: null,
    transcript: submission.transcript,
  });

  await enqueueMeetingJob({
    sb,
    tenantId: job.tenantId,
    meetingId: job.meetingId,
    stage: "analyze",
  });
}

// ---------------------------------------------------------------------------
// transcript — busca o resultado e grava os segmentos
// ---------------------------------------------------------------------------

export async function persistTranscript(
  sb: SupabaseServiceClient,
  params: {
    tenantId: string;
    meetingId: string;
    processingVersion: number;
    providerJobId: string | null;
    transcript: NormalizedTranscript;
  },
): Promise<void> {
  const { transcript } = params;

  for (let index = 0; index < transcript.segments.length; index += SEGMENT_BATCH) {
    const batch = transcript.segments.slice(index, index + SEGMENT_BATCH).map((segment) => ({
      idx: segment.idx,
      speaker_label: segment.speakerLabel,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      text: segment.text,
      confidence: segment.confidence,
    }));

    const { error } = await sb.rpc("append_meeting_transcript_segments_v1", {
      p_meeting_id: params.meetingId,
      p_tenant_id: params.tenantId,
      p_provider_job_id: params.providerJobId,
      p_processing_version: params.processingVersion,
      p_segments: batch,
    });
    if (error) throw new Error(safeMeetingErrorCode(error.message));
  }

  const { error: finalizeError } = await sb.rpc("finalize_meeting_transcript_v1", {
    p_meeting_id: params.meetingId,
    p_tenant_id: params.tenantId,
    p_provider_job_id: params.providerJobId,
    p_processing_version: params.processingVersion,
    p_duration_ms: transcript.durationMs,
    p_language: transcript.languageCode,
    p_speaker_labels: transcript.speakerLabels,
  });
  if (finalizeError) throw new Error(safeMeetingErrorCode(finalizeError.message));
}

async function runTranscriptStage(sb: SupabaseServiceClient, job: MeetingJobRow): Promise<void> {
  const meeting = await loadMeetingRow(sb, job.tenantId, job.meetingId);
  if (!meeting.provider_job_id) throw new Error("meeting_provider_job_missing");

  const provider = resolveTranscriptionProvider(meeting.provider);
  const transcript = await provider.fetchResult(meeting.provider_job_id);

  await persistTranscript(sb, {
    tenantId: job.tenantId,
    meetingId: job.meetingId,
    processingVersion: job.processingVersion,
    providerJobId: meeting.provider_job_id,
    transcript,
  });

  await enqueueMeetingJob({
    sb,
    tenantId: job.tenantId,
    meetingId: job.meetingId,
    stage: "analyze",
  });
}

// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------

async function loadSegments(
  sb: SupabaseServiceClient,
  tenantId: string,
  meetingId: string,
  processingVersion: number,
): Promise<NormalizedSegment[]> {
  const { data, error } = await sb
    .from("meeting_transcript_segments")
    .select("idx, speaker_label, start_ms, end_ms, text, confidence")
    .eq("tenant_id", tenantId)
    .eq("meeting_id", meetingId)
    .eq("processing_version", processingVersion)
    .order("idx", { ascending: true });

  if (error) throw new Error("meeting_segments_read_failed");
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    idx: Number(row.idx),
    speakerLabel: typeof row.speaker_label === "string" ? row.speaker_label : null,
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    text: String(row.text ?? ""),
    confidence: row.confidence === null ? null : Number(row.confidence),
  }));
}

async function runAnalyzeStage(sb: SupabaseServiceClient, job: MeetingJobRow): Promise<void> {
  const meeting = await loadMeetingRow(sb, job.tenantId, job.meetingId);
  const segments = await loadSegments(sb, job.tenantId, job.meetingId, job.processingVersion);
  if (segments.length === 0) throw new Error("meeting_analysis_empty_transcript");

  const hasDiarization = segments.some((segment) => segment.speakerLabel !== null);

  const outcome = await runMeetingAnalysis({
    tenantId: job.tenantId,
    meetingId: job.meetingId,
    templateKey: meeting.meeting_type,
    segments,
    userNotes: meeting.user_notes,
    durationMs: meeting.duration_ms,
    recordedAt: meeting.recorded_at,
    hasDiarization,
  });

  const { error } = await sb.rpc("save_meeting_analysis_v1", {
    p_job_id: job.id,
    p_claim_token: job.claimToken,
    p_template_key: outcome.templateKey,
    p_schema_version: outcome.schemaVersion,
    p_summary_short: outcome.analysis.summaryShort,
    p_summary_long: outcome.analysis.summaryLong,
    p_payload: outcome.analysis.payload,
    p_model: outcome.model,
    p_input_tokens: outcome.inputTokens,
    p_output_tokens: outcome.outputTokens,
    p_cost_usd: outcome.costUsd,
    p_action_items: outcome.analysis.actionItems.map((item) => ({
      text: item.text,
      assignee_raw: item.assigneeRaw,
      due_date: item.dueDate,
      due_date_inferred: item.dueDateInferred,
      priority: item.priority,
      at_ms: item.atMs,
    })),
    p_decisions: outcome.analysis.decisions.map((decision) => ({
      text: decision.text,
      at_ms: decision.atMs,
      made_by_speaker_label: decision.madeBySpeakerLabel,
    })),
  });
  if (error) throw new Error(safeMeetingErrorCode(error.message));

  // Consumo só é registrado quando o áudio foi de fato processado — falha não
  // consome cota.
  if (meeting.duration_ms && meeting.duration_ms > 0) {
    await recordMeetingUsage({
      sb,
      tenantId: job.tenantId,
      seconds: Math.round(meeting.duration_ms / 1000),
    });
  }

  await appendOperationalAuditEvent({
    tenantId: job.tenantId,
    actorType: "worker",
    module: "meetings",
    action: "analysis_completed",
    resourceType: "meeting",
    resourceId: job.meetingId,
    status: "completed",
    metadata: {
      template: outcome.templateKey,
      action_items: outcome.analysis.actionItems.length,
      decisions: outcome.analysis.decisions.length,
      // Itens que o modelo produziu sem âncora válida no áudio. Subida
      // sustentada aqui é sinal de prompt degradando.
      dropped_items: outcome.analysis.droppedItems,
    },
  });

  await enqueueMeetingJob({
    sb,
    tenantId: job.tenantId,
    meetingId: job.meetingId,
    stage: "notify",
  });
  await enqueueMeetingJob({
    sb,
    tenantId: job.tenantId,
    meetingId: job.meetingId,
    stage: "index",
  });
}

// ---------------------------------------------------------------------------
// index — trechos e vetores para a busca entre reuniões
// ---------------------------------------------------------------------------

const EMBEDDING_BATCH = 96;

async function runIndexStage(sb: SupabaseServiceClient, job: MeetingJobRow): Promise<void> {
  const segments = await loadSegments(sb, job.tenantId, job.meetingId, job.processingVersion);
  if (segments.length === 0) return;

  const chunks = buildSearchChunks(segments);
  if (chunks.length === 0) return;

  for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH) {
    const batch = chunks.slice(index, index + EMBEDDING_BATCH);
    const vectors = await embedTexts(batch.map((chunk) => chunk.content));

    // Sem embeddings (chave ausente, provedor fora) a reunião NÃO fica sem
    // busca: os trechos entram mesmo assim e o ramo lexical funciona. Falhar
    // aqui tiraria a reunião da busca por um motivo que nada tem a ver com ela.
    if (!vectors) {
      console.warn("[meeting-pipeline] index sem embeddings — indexação lexical apenas");
      return;
    }

    const { error } = await sb.rpc("insert_meeting_chunks_v1", {
      p_job_id: job.id,
      p_claim_token: job.claimToken,
      p_chunks: batch.map((chunk, position) => ({
        idx: chunk.idx,
        content: chunk.content,
        start_ms: chunk.startMs,
        end_ms: chunk.endMs,
        embedding: vectors[position],
      })),
    });
    if (error) throw new Error(safeMeetingErrorCode(error.message));
  }
}

// ---------------------------------------------------------------------------
// notify
// ---------------------------------------------------------------------------

export async function broadcastMeetingChange(
  sb: SupabaseServiceClient,
  tenantId: string,
  meetingId: string,
  status: string,
): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const channel = sb.channel(meetingsRealtimeChannel(tenantId));
      channel.subscribe((state) => {
        if (state === "SUBSCRIBED") {
          void channel
            .send({
              type: "broadcast",
              event: MEETING_REALTIME_EVENT,
              payload: { meetingId, status },
            })
            .then(() => {
              void sb.removeChannel(channel);
              resolve();
            })
            .catch(reject);
        }
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          void sb.removeChannel(channel);
          reject(new Error(`realtime channel ${state}`));
        }
      });
    });
  } catch (error) {
    // Aviso não pode derrubar o pipeline: a reunião já está pronta no banco.
    console.warn("[meeting-pipeline] broadcast falhou", safeMeetingErrorCode(error));
  }
}

async function runNotifyStage(sb: SupabaseServiceClient, job: MeetingJobRow): Promise<void> {
  const meeting = await loadMeetingRow(sb, job.tenantId, job.meetingId);
  await broadcastMeetingChange(sb, job.tenantId, job.meetingId, meeting.status);
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

/** Status da reunião quando o estágio termina bem. */
const NEXT_STATUS: Partial<Record<MeetingJobRow["stage"], "analyzing" | "completed" | null>> = {
  prepare: null, // `prepare` define o status por conta própria (transcribing ou analyzing)
  transcript: "analyzing",
  analyze: "completed",
  // `index` e `notify` acontecem depois de a reunião já estar concluída: falha
  // neles não pode rebaixar o status de algo que o usuário já pode usar.
  index: null,
  notify: null,
};

export async function processMeetingJob(
  sb: SupabaseServiceClient,
  job: MeetingJobRow,
): Promise<"completed" | "failed"> {
  try {
    await withMeetingJobHeartbeat(sb, job, async () => {
      if (job.stage === "prepare") return runPrepareStage(sb, job);
      if (job.stage === "transcript") return runTranscriptStage(sb, job);
      if (job.stage === "analyze") return runAnalyzeStage(sb, job);
      if (job.stage === "index") return runIndexStage(sb, job);
      if (job.stage === "notify") return runNotifyStage(sb, job);
      throw new Error(`meeting_stage_unsupported_${job.stage}`);
    });

    await finishMeetingJob({
      sb,
      job,
      success: true,
      meetingStatus: NEXT_STATUS[job.stage] ?? null,
    });
    return "completed";
  } catch (error) {
    const code = safeMeetingErrorCode(error);
    await finishMeetingJob({ sb, job, success: false, errorCode: code });

    await appendOperationalAuditEvent({
      tenantId: job.tenantId,
      actorType: "worker",
      module: "meetings",
      action: `stage_${job.stage}_failed`,
      resourceType: "meeting",
      resourceId: job.meetingId,
      status: "error",
      severity: job.attempts >= job.maxAttempts ? "error" : "warning",
      attempt: job.attempts,
      resultCode: code,
    });

    console.error("[meeting-pipeline] stage failed", {
      job_id: job.id,
      stage: job.stage,
      attempt: job.attempts,
      code,
    });
    return "failed";
  }
}

export async function processDueMeetingJobs(params: {
  sb?: SupabaseServiceClient;
  limit?: number;
} = {}): Promise<{ claimed: number; completed: number; failed: number }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const jobs = await claimMeetingJobs({ sb, limit: params.limit ?? 3 });

  const result = { claimed: jobs.length, completed: 0, failed: 0 };
  // Em paralelo de propósito: cada job reivindicado precisa começar já, senão a
  // lease dos últimos expira enquanto o primeiro ainda processa.
  const outcomes = await Promise.all(jobs.map((job) => processMeetingJob(sb, job)));
  for (const outcome of outcomes) {
    if (outcome === "completed") result.completed += 1;
    else result.failed += 1;
  }
  return result;
}
