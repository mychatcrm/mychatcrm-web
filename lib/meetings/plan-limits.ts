/**
 * Politica comercial do modulo de reunioes.
 *
 * ESTE E O UNICO ARQUIVO A MEXER quando as cotas ou os prazos de retencao
 * mudarem. Nada disso vive no schema de proposito: e decisao comercial, e
 * decisao comercial nao deve exigir migration.
 *
 * Custo de referencia (set/2026): ~US$0,27 por hora de audio processado,
 * dominado pela transcricao. As cotas abaixo mantem o custo maximo teorico
 * abaixo de ~12% da receita do plano, mesmo se o workspace usar tudo.
 */
import { normalizeToPlan, type NormalizedPlan } from "@/lib/plan-policy";

export type MeetingPlanLimits = {
  /** Horas de audio processado incluidas por ciclo mensal, somadas no workspace. */
  includedHoursPerMonth: number;
  /** Dias que o audio original sobrevive. Transcricao e analise ficam para sempre. */
  audioRetentionDays: number;
  /** Teto por arquivo, independente da cota — contencao de abuso. */
  maxDurationMinutesPerMeeting: number;
  maxUploadBytes: number;
  /** Tetos diarios de criacao, por usuario e por workspace. */
  maxMeetingsPerUserPerDay: number;
  maxMeetingsPerTenantPerDay: number;
};

const POLICY: Record<NormalizedPlan, MeetingPlanLimits> = {
  solo: {
    includedHoursPerMonth: 8,
    audioRetentionDays: 90,
    maxDurationMinutesPerMeeting: 240,
    maxUploadBytes: 500 * 1024 * 1024,
    maxMeetingsPerUserPerDay: 20,
    maxMeetingsPerTenantPerDay: 40,
  },
  equipa: {
    includedHoursPerMonth: 30,
    audioRetentionDays: 180,
    maxDurationMinutesPerMeeting: 240,
    maxUploadBytes: 500 * 1024 * 1024,
    maxMeetingsPerUserPerDay: 20,
    maxMeetingsPerTenantPerDay: 100,
  },
  escala: {
    includedHoursPerMonth: 80,
    audioRetentionDays: 365,
    maxDurationMinutesPerMeeting: 240,
    maxUploadBytes: 500 * 1024 * 1024,
    maxMeetingsPerUserPerDay: 20,
    maxMeetingsPerTenantPerDay: 200,
  },
  enterprise: {
    includedHoursPerMonth: 200,
    audioRetentionDays: 365,
    maxDurationMinutesPerMeeting: 480,
    maxUploadBytes: 1024 * 1024 * 1024,
    maxMeetingsPerUserPerDay: 50,
    maxMeetingsPerTenantPerDay: 500,
  },
};

export function getMeetingPlanLimits(plan: string): MeetingPlanLimits {
  return POLICY[normalizeToPlan(plan)];
}

export function includedSecondsPerMonth(plan: string): number {
  return getMeetingPlanLimits(plan).includedHoursPerMonth * 3600;
}

/**
 * Quando o audio desta reuniao deve ser apagado.
 *
 * Retencao curta e primeiro uma decisao de privacidade: gravacao de conversa e
 * o dado mais sensivel que o produto guarda, e o custo de storage e irrelevante
 * perto disso.
 */
export function resolveAudioRetentionUntil(plan: string, from = new Date()): Date {
  const days = getMeetingPlanLimits(plan).audioRetentionDays;
  const until = new Date(from.getTime());
  until.setUTCDate(until.getUTCDate() + days);
  return until;
}

export type MeetingQuotaState = {
  includedSeconds: number;
  usedSeconds: number;
  bonusSeconds: number;
  remainingSeconds: number;
  /** Fracao consumida (0 a 1+). Acima de 0.8 a interface avisa. */
  ratio: number;
  exhausted: boolean;
  shouldWarn: boolean;
};

export const MEETING_QUOTA_WARN_RATIO = 0.8;

export function computeMeetingQuotaState(params: {
  plan: string;
  usedSeconds: number;
  bonusSeconds?: number;
}): MeetingQuotaState {
  const includedSeconds = includedSecondsPerMonth(params.plan);
  const usedSeconds = Math.max(0, Math.floor(params.usedSeconds));
  const bonusSeconds = Math.max(0, Math.floor(params.bonusSeconds ?? 0));
  const total = includedSeconds + bonusSeconds;
  const remainingSeconds = Math.max(0, total - usedSeconds);
  const ratio = total > 0 ? usedSeconds / total : 1;
  return {
    includedSeconds,
    usedSeconds,
    bonusSeconds,
    remainingSeconds,
    ratio,
    exhausted: remainingSeconds <= 0,
    shouldWarn: ratio >= MEETING_QUOTA_WARN_RATIO,
  };
}
