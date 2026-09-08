import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getInternalApiToken, internalApiAuthHeaders } from "@/lib/server/internal-api-auth";
import type { MeetingStatus } from "@/lib/meetings/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type MeetingJobStage =
  | "prepare"
  | "transcript"
  | "analyze"
  | "index"
  | "notify"
  | "retention";

export type MeetingJobRow = {
  id: string;
  tenantId: string;
  meetingId: string;
  stage: MeetingJobStage;
  processingVersion: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  claimToken: string;
  payload: Record<string, unknown>;
};

export function toMeetingJobRow(row: Record<string, unknown>): MeetingJobRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    meetingId: String(row.meeting_id),
    stage: String(row.stage) as MeetingJobStage,
    processingVersion: Number(row.processing_version ?? 1),
    status: String(row.status ?? "pending"),
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 4),
    claimToken: String(row.claim_token ?? ""),
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
  };
}

/** Código curto e sem PII, no formato que o banco aceita em `last_error_code`. */
export function safeMeetingErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "meeting_processing_failed");
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 96) || "meeting_processing_failed"
  );
}

export async function enqueueMeetingJob(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  meetingId: string;
  stage: MeetingJobStage;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  const { error } = await params.sb.rpc("enqueue_meeting_job_v1", {
    p_meeting_id: params.meetingId,
    p_tenant_id: params.tenantId,
    p_stage: params.stage,
    p_payload: params.payload ?? {},
  });
  if (error) {
    console.error("[meeting-jobs] enqueue failed", { stage: params.stage, reason: error.message });
    return false;
  }
  return true;
}

export async function claimMeetingJobs(params: {
  sb: SupabaseServiceClient;
  limit?: number;
  claimSeconds?: number;
}): Promise<MeetingJobRow[]> {
  const { data, error } = await params.sb.rpc("claim_meeting_jobs_v1", {
    p_limit: Math.max(1, Math.min(params.limit ?? 3, 10)),
    p_claim_seconds: params.claimSeconds ?? 120,
  });
  if (error) throw new Error(`meeting_claim_failed:${error.message}`);
  const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  return rows.map(toMeetingJobRow);
}

export async function heartbeatMeetingJob(params: {
  sb: SupabaseServiceClient;
  job: MeetingJobRow;
  extendSeconds?: number;
}): Promise<boolean> {
  const { data, error } = await params.sb.rpc("heartbeat_meeting_job_v1", {
    p_job_id: params.job.id,
    p_claim_token: params.job.claimToken,
    p_extend_seconds: params.extendSeconds ?? 120,
  });
  return !error && data === true;
}

export async function finishMeetingJob(params: {
  sb: SupabaseServiceClient;
  job: MeetingJobRow;
  success: boolean;
  /** Próximo status da reunião no caminho feliz. `null` deixa como está. */
  meetingStatus?: MeetingStatus | null;
  errorCode?: string | null;
}): Promise<boolean> {
  const { data, error } = await params.sb.rpc("finish_meeting_job_v1", {
    p_job_id: params.job.id,
    p_claim_token: params.job.claimToken,
    p_success: params.success,
    p_meeting_status: params.meetingStatus ?? null,
    p_error_code: params.errorCode ?? null,
  });
  if (error) {
    console.error("[meeting-jobs] finish failed", { job_id: params.job.id, reason: error.message });
    return false;
  }
  return data === true;
}

/**
 * Acorda o processador imediatamente, sem esperar o watchdog de minuto.
 *
 * Fire-and-forget de propósito: se a chamada falhar, o pg_cron pega o job no
 * próximo minuto. O caminho rápido não pode derrubar quem o disparou.
 */
export async function triggerMeetingJobProcessor(): Promise<boolean> {
  const secret = getInternalApiToken();
  if (!secret) {
    console.warn("[meeting-jobs] dispatch sem INTERNAL_API_TOKEN — watchdog assume");
    return false;
  }

  const base =
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    process.env.MYCHATCRM_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ||
    "";
  if (!base) return false;

  try {
    const response = await fetch(new URL("/api/internal/meetings/dispatch", base).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalApiAuthHeaders() },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch (error) {
    console.warn("[meeting-jobs] dispatch falhou", safeMeetingErrorCode(error));
    return false;
  }
}

/**
 * Mantém a posse do job durante um trabalho longo.
 *
 * Sem batimento, uma etapa que passe da lease é reivindicada por outro worker
 * e passa a rodar duas vezes — em `analyze` isso significaria pagar a OpenAI
 * duas vezes pela mesma reunião.
 */
export async function withMeetingJobHeartbeat<T>(
  sb: SupabaseServiceClient,
  job: MeetingJobRow,
  work: () => Promise<T>,
  intervalMs = 45_000,
): Promise<T> {
  let lost = false;
  const timer = setInterval(() => {
    void heartbeatMeetingJob({ sb, job }).then((ok) => {
      if (!ok) lost = true;
    });
  }, intervalMs);

  try {
    const result = await work();
    if (lost) throw new Error("meeting_claim_lost");
    return result;
  } finally {
    clearInterval(timer);
  }
}
