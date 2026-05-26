/** Pure follow-up decision engine — obedece 100% às configurações do agente. */

import type { AgentFollowUpInteligente } from "@/lib/types";

export type FollowUpMode = AgentFollowUpInteligente["modo"];

export type FollowUpType =
  | "silence"
  | "sla_breach"
  | "human_abandoned"
  | "lead_cooling";

export type FollowUpUrgency = "critical" | "high" | "medium" | "low";

export type FollowUpEvalContext = {
  now: Date;
  settings: AgentFollowUpInteligente;
  job: {
    id: string;
    attempts: number;
    maxAttempts: number;
    createdAt: Date;
  };
  lead: {
    id: string | null;
    name: string | null;
    status: string | null;
    lastMessageAt: Date | null;
    lastFollowUpAt: Date | null;
    followUpCount: number;
    followUpCooldownUntil: Date | null;
  } | null;
  conversationState: {
    humanPaused: boolean;
    pausedReason: string | null;
    handoffSuggested: boolean;
    conversationMode: string | null;
    archivedAt: Date | null;
  } | null;
  lastCustomerMessageAt: Date | null;
  lastAgentMessageAt: Date | null;
  lastHumanOutboundAt: Date | null;
  hasFutureTask: boolean;
};

export type FollowUpDecision = {
  shouldSend: boolean;
  reason: string;
  skipReason: string | null;
  followUpType: FollowUpType;
  priority: 1 | 2 | 3 | 4 | 5;
  urgency: FollowUpUrgency;
  nextRetryAt: Date | null;
  cooldownActive: boolean;
  humanBlocked: boolean;
  spamRisk: boolean;
  businessHoursBlocked: boolean;
};

const LOST_STATUSES = new Set(["perdido", "inativo", "cancelado", "arquivado"]);

function clampPriority(n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(n))) as 1 | 2 | 3 | 4 | 5;
}

/** Returns the local hour (0-23) and weekday (0=Sun … 6=Sat) in the given IANA timezone. */
function getLocalHourAndDay(date: Date, timezone: string): { hour: number; day: number } {
  if (timezone === "UTC") {
    return { hour: date.getUTCHours(), day: date.getUTCDay() };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "";
    const monthStr = parts.find((p) => p.type === "month")?.value ?? "";
    const dayStr = parts.find((p) => p.type === "day")?.value ?? "";
    const yearStr = parts.find((p) => p.type === "year")?.value ?? "";

    let hour = parseInt(hourStr, 10);
    if (isNaN(hour)) return { hour: date.getUTCHours(), day: date.getUTCDay() };
    if (hour === 24) hour = 0; // some runtimes return 24 for midnight

    // Build the calendar date string (ISO format → always parsed as UTC midnight)
    const localDate = new Date(`${yearStr}-${monthStr}-${dayStr}`);
    const weekday = isNaN(localDate.getTime()) ? date.getUTCDay() : localDate.getUTCDay();

    return { hour, day: weekday };
  } catch {
    // Invalid timezone — fall back to UTC
    return { hour: date.getUTCHours(), day: date.getUTCDay() };
  }
}

export function isWithinBusinessHours(
  now: Date,
  settings: Pick<AgentFollowUpInteligente, "horaInicio" | "horaFim" | "diasAtivos" | "timezone">,
): boolean {
  const tz = settings.timezone ?? "UTC";
  const { hour, day } = getLocalHourAndDay(now, tz);
  if (settings.diasAtivos.length > 0 && !settings.diasAtivos.includes(day)) return false;
  return hour >= settings.horaInicio && hour < settings.horaFim;
}

export function nextBusinessHourStart(
  now: Date,
  settings: Pick<AgentFollowUpInteligente, "horaInicio" | "horaFim" | "diasAtivos" | "timezone">,
): Date {
  // Iterate 1-hour steps (max 8 days) to find the next window that passes isWithinBusinessHours.
  // This correctly handles DST transitions and day-boundary effects in any timezone.
  for (let h = 1; h <= 192; h++) {
    const candidate = new Date(now.getTime() + h * 3_600_000);
    if (isWithinBusinessHours(candidate, settings)) return candidate;
  }
  return new Date(now.getTime() + 24 * 3_600_000);
}

export function evaluateFollowUpNeed(ctx: FollowUpEvalContext): FollowUpDecision {
  const { now, settings, job, lead, conversationState } = ctx;

  const base: FollowUpDecision = {
    shouldSend: false,
    reason: "no_trigger",
    skipReason: null,
    followUpType: "silence",
    priority: 4,
    urgency: "medium",
    nextRetryAt: null,
    cooldownActive: false,
    humanBlocked: false,
    spamRisk: false,
    businessHoursBlocked: false,
  };

  if (!settings.ativo) return { ...base, skipReason: "follow_up_disabled" };

  if (job.attempts >= job.maxAttempts) {
    return { ...base, skipReason: "max_attempts_reached" };
  }

  if (settings.bloquearStatusPerdido) {
    const leadStatus = lead?.status?.toLowerCase() ?? "";
    if (leadStatus && LOST_STATUSES.has(leadStatus)) {
      return { ...base, skipReason: `lead_status_${leadStatus}` };
    }
  }

  if (settings.respeitarHumanoAtivo) {
    if (conversationState?.humanPaused) {
      return { ...base, humanBlocked: true, skipReason: "human_paused" };
    }
    if (conversationState?.conversationMode === "human") {
      return { ...base, humanBlocked: true, skipReason: "conversation_mode_human" };
    }
    if (ctx.lastHumanOutboundAt) {
      const twoIntervalsMs = settings.intervaloVerificacaoMinutos * 2 * 60_000;
      const timeSinceHuman = now.getTime() - ctx.lastHumanOutboundAt.getTime();
      if (timeSinceHuman < twoIntervalsMs) {
        return { ...base, humanBlocked: true, skipReason: "human_recently_active" };
      }
    }
  }

  if (conversationState?.archivedAt) {
    return { ...base, skipReason: "conversation_archived" };
  }

  if (
    settings.bloquearSeLeadRespondeu &&
    ctx.lastCustomerMessageAt &&
    ctx.lastCustomerMessageAt > job.createdAt
  ) {
    return { ...base, skipReason: "customer_replied" };
  }

  if (settings.bloquearTarefaFutura && ctx.hasFutureTask) {
    return { ...base, skipReason: "future_task_scheduled" };
  }

  if (settings.cooldownAtivo) {
    const cooldownMs = settings.cooldownMinutos * 60_000;
    if (lead?.lastFollowUpAt) {
      const timeSinceLast = now.getTime() - lead.lastFollowUpAt.getTime();
      if (timeSinceLast < cooldownMs) {
        return { ...base, cooldownActive: true, spamRisk: true, skipReason: "cooldown_active" };
      }
    }
    if (lead?.followUpCooldownUntil && lead.followUpCooldownUntil > now) {
      return { ...base, cooldownActive: true, skipReason: "cooldown_until" };
    }
  }

  if (settings.usarHorarioComercial && !isWithinBusinessHours(now, settings)) {
    const nextSlot = nextBusinessHourStart(now, settings);
    return {
      ...base,
      businessHoursBlocked: true,
      nextRetryAt: nextSlot,
      skipReason: "outside_business_hours",
    };
  }

  if (settings.retomadaApenasSeHumanoAbandonou) {
    if (!ctx.lastHumanOutboundAt) {
      return { ...base, skipReason: "retomada_apenas_humano_sem_historico" };
    }
    const lastAgentTs = ctx.lastAgentMessageAt?.getTime() ?? 0;
    const lastHumanTs = ctx.lastHumanOutboundAt.getTime();
    if (lastAgentTs > lastHumanTs) {
      return { ...base, skipReason: "agent_responded_after_human" };
    }
  }

  let followUpType: FollowUpType = "silence";
  let priority: number = 4;
  let urgency: FollowUpUrgency = "medium";
  let reason = "customer_silence";

  if (settings.permitirSlaVencido && settings.slaHorasResposta) {
    const slaMs = settings.slaHorasResposta * 3_600_000;
    const lastActivity =
      ctx.lastCustomerMessageAt?.getTime() ?? job.createdAt.getTime();
    if (now.getTime() - lastActivity > slaMs) {
      followUpType = "sla_breach";
      priority = 1;
      urgency = "critical";
      reason = "sla_breached";
    }
  }

  if (
    followUpType === "silence" &&
    settings.retomadaApenasSeHumanoAbandonou &&
    ctx.lastHumanOutboundAt &&
    settings.permitirSlaVencido &&
    settings.slaHorasResposta
  ) {
    const slaMs = settings.slaHorasResposta * 3_600_000;
    const timeHumanSilent = now.getTime() - ctx.lastHumanOutboundAt.getTime();
    if (timeHumanSilent > slaMs && !ctx.lastCustomerMessageAt) {
      followUpType = "human_abandoned";
      priority = 2;
      urgency = "high";
      reason = "human_abandoned_customer";
    }
  }

  if (followUpType === "silence" && job.attempts >= 1) {
    followUpType = "lead_cooling";
    priority = 3;
    urgency = "medium";
    reason = "lead_cooling";
  }

  if (job.attempts === 0 && followUpType !== "sla_breach") {
    priority = Math.min(5, priority + 1);
  }
  if (job.attempts >= 2 && priority > 2) priority = priority - 1;

  let adjustedUrgency: FollowUpUrgency = urgency;
  if (settings.modo === "agressivo") {
    const order: FollowUpUrgency[] = ["low", "medium", "high", "critical"];
    const idx = order.indexOf(adjustedUrgency);
    if (idx >= 0 && idx < order.length - 1) adjustedUrgency = order[idx + 1]!;
  } else if (settings.modo === "suave") {
    const order: FollowUpUrgency[] = ["low", "medium", "high", "critical"];
    const idx = order.indexOf(adjustedUrgency);
    if (idx > 0) adjustedUrgency = order[idx - 1]!;
  }

  return {
    shouldSend: true,
    reason,
    skipReason: null,
    followUpType,
    priority: clampPriority(priority),
    urgency: adjustedUrgency,
    nextRetryAt: null,
    cooldownActive: false,
    humanBlocked: false,
    spamRisk: false,
    businessHoursBlocked: false,
  };
}

const MODO_MAP: Record<FollowUpMode, string> = {
  agressivo:
    "Seja direto. Mencione o interesse concreto do cliente e crie urgência legítima. Peça um próximo passo ou decisão.",
  moderado:
    "Retome a conversa de forma natural. Mencione o que já foi discutido e mostre que ainda está disponível.",
  suave:
    "Seja gentil e breve. Mostre disponibilidade sem pressionar. Deixe o cliente no comando do ritmo.",
};

const TYPE_MAP: Record<FollowUpType, (name: string) => string> = {
  silence: (n) =>
    `O cliente${n} não respondeu após a última mensagem. Retome de forma contextual, lembrando o assunto real.`,
  sla_breach: (n) =>
    `O prazo de resposta foi ultrapassado para este lead${n}. Crie uma mensagem relevante — o lead pode estar avaliando concorrentes.`,
  human_abandoned: (n) =>
    `Um atendente humano estava em contato com o cliente${n} mas não deu continuidade. Retome com sensibilidade; não exponha a falha interna.`,
  lead_cooling: (n) =>
    `Este lead${n} demonstrou interesse mas a conversa esfriou. Recupere a oportunidade usando dados já compartilhados.`,
};

export function buildFollowUpAiInstruction(params: {
  decision: FollowUpDecision;
  leadName: string | null;
  settings: Pick<
    AgentFollowUpInteligente,
    "modo" | "usarDadosFormularioMeta" | "usarHistoricoCrm" | "usarHistoricoWhatsapp"
  >;
  attemptNumber: number;
}): string {
  const { decision, leadName, settings, attemptNumber } = params;
  const nameStr = leadName ? ` (${leadName})` : "";

  const typeCtx =
    TYPE_MAP[decision.followUpType]?.(nameStr) ?? TYPE_MAP.silence(nameStr);
  const modeCtx = MODO_MAP[settings.modo];

  const attemptNote =
    attemptNumber === 0
      ? "Esta é a primeira tentativa de retomada."
      : attemptNumber === 1
        ? "Segunda tentativa — varie a abordagem; não repita a mensagem anterior."
        : "Varie completamente a abordagem em relação às tentativas anteriores.";

  const sourceLines: string[] = [];
  if (settings.usarHistoricoWhatsapp) {
    sourceLines.push("- Use o histórico do WhatsApp acima para personalizar.");
  } else {
    sourceLines.push("- Não há histórico de WhatsApp incluído; use apenas o contexto abaixo.");
  }
  if (settings.usarHistoricoCrm) {
    sourceLines.push("- Use dados do CRM/memória do lead quando disponíveis no system prompt.");
  }
  if (settings.usarDadosFormularioMeta) {
    sourceLines.push("- Use dados do formulário Meta Lead Ads quando disponíveis no system prompt.");
  } else {
    sourceLines.push("- Não mencione campos de formulário Meta (desativado nas configurações).");
  }

  return [
    typeCtx,
    "",
    `Estratégia: ${modeCtx}`,
    "",
    attemptNote,
    "Regras obrigatórias:",
    ...sourceLines,
    "- Nunca use templates genéricos como «Olá, tudo bem?» sem contexto.",
    "- Não revele que é um sistema automático de follow-up.",
    "- Seja breve, natural e humano.",
    `- Nível de urgência: ${decision.urgency}.`,
  ].join("\n");
}
