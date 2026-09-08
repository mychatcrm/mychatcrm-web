import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import {
  computeMeetingQuotaState,
  getMeetingPlanLimits,
  type MeetingQuotaState,
} from "@/lib/meetings/plan-limits";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Primeiro dia do mes civil em UTC — mesmo formato de `tenant_lead_usage`. */
export function currentMeetingCycleMonthUTC(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}-01`;
}

export async function readMeetingUsage(
  sb: SupabaseServiceClient,
  tenantId: string,
): Promise<{ usedSeconds: number; bonusSeconds: number; meetingsCount: number }> {
  const { data, error } = await sb
    .from("tenant_meeting_usage")
    .select("seconds_processed, bonus_seconds, meetings_count")
    .eq("tenant_id", tenantId)
    .eq("cycle_month", currentMeetingCycleMonthUTC())
    .maybeSingle();

  if (error) {
    console.error("[meeting-quota] usage read failed", error.message);
    // Falha de leitura NAO pode virar bloqueio: derrubar a gravacao porque uma
    // consulta de contabilidade falhou seria pior que passar alguns minutos do
    // teto. O consumo continua sendo registrado.
    return { usedSeconds: 0, bonusSeconds: 0, meetingsCount: 0 };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    usedSeconds: Number(row.seconds_processed ?? 0),
    bonusSeconds: Number(row.bonus_seconds ?? 0),
    meetingsCount: Number(row.meetings_count ?? 0),
  };
}

export async function getMeetingQuotaState(
  sb: SupabaseServiceClient,
  session: ClientSession,
): Promise<MeetingQuotaState> {
  const usage = await readMeetingUsage(sb, session.tenantId);
  return computeMeetingQuotaState({
    plan: session.plan,
    usedSeconds: usage.usedSeconds,
    bonusSeconds: usage.bonusSeconds,
  });
}

export class MeetingQuotaExceededError extends Error {
  readonly code = "MEETING_QUOTA_EXCEEDED";
  readonly state: MeetingQuotaState;

  constructor(state: MeetingQuotaState) {
    super("meeting_quota_exceeded");
    this.name = "MeetingQuotaExceededError";
    this.state = state;
  }
}

/**
 * Portao de entrada da cota.
 *
 * Checado ao INICIAR o upload, nunca ao finalizar: interromper uma gravacao que
 * ja aconteceu nao devolve o tempo do usuario, so joga fora a reuniao dele.
 */
export async function assertMeetingQuotaAvailable(
  sb: SupabaseServiceClient,
  session: ClientSession,
): Promise<MeetingQuotaState> {
  const state = await getMeetingQuotaState(sb, session);
  if (state.exhausted) throw new MeetingQuotaExceededError(state);
  return state;
}

/** Consumo so e registrado quando o audio foi de fato processado. */
export async function recordMeetingUsage(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  seconds: number;
}): Promise<void> {
  const seconds = Math.max(0, Math.round(params.seconds));
  if (seconds === 0) return;

  const { error } = await params.sb.rpc("increment_meeting_usage_v1", {
    p_tenant_id: params.tenantId,
    p_seconds: seconds,
  });
  if (error) {
    // Nao derruba o pipeline: a reuniao do cliente vale mais que a linha de
    // contabilidade. Fica no log para reconciliacao.
    console.error("[meeting-quota] usage increment failed", error.message);
  }
}

/** Teto por arquivo, independente da cota mensal — contencao de abuso. */
export function assertMeetingWithinPerFileLimits(params: {
  plan: string;
  sizeBytes?: number;
  durationMs?: number | null;
}): void {
  const limits = getMeetingPlanLimits(params.plan);

  if (params.sizeBytes !== undefined && params.sizeBytes > limits.maxUploadBytes) {
    throw new Error("meeting_file_too_large");
  }
  if (
    params.durationMs !== undefined &&
    params.durationMs !== null &&
    params.durationMs > limits.maxDurationMinutesPerMeeting * 60_000
  ) {
    throw new Error("meeting_duration_too_long");
  }
}
