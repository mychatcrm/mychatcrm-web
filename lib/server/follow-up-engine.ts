/** Pure, side-effect-free follow-up decision engine. No DB calls; fully unit-testable. */

export type FollowUpMode = "agressivo" | "moderado" | "suave";

export type FollowUpType =
  | "silence"
  | "sla_breach"
  | "human_abandoned"
  | "lead_cooling";

export type FollowUpUrgency = "critical" | "high" | "medium" | "low";

export type FollowUpEvalSettings = {
  ativo: boolean;
  tentativasContato: number;
  intervaloVerificacaoMinutos: number;
  modo: FollowUpMode;
  cooldownMinutos: number;
  slaHorasResposta: number | null;
  horaInicio: number;
  horaFim: number;
  diasAtivos: number[];
  retomadaApenasSeHumanoAbandonou: boolean;
};

export type FollowUpEvalContext = {
  now: Date;
  settings: FollowUpEvalSettings;
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
const MIN_GLOBAL_COOLDOWN_MINUTES = 30;

function clampPriority(n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(n))) as 1 | 2 | 3 | 4 | 5;
}

export function isWithinBusinessHours(
  now: Date,
  settings: Pick<FollowUpEvalSettings, "horaInicio" | "horaFim" | "diasAtivos">,
): boolean {
  const hour = now.getUTCHours();
  const day = now.getUTCDay();
  if (settings.diasAtivos.length > 0 && !settings.diasAtivos.includes(day)) return false;
  return hour >= settings.horaInicio && hour < settings.horaFim;
}

export function nextBusinessHourStart(
  now: Date,
  settings: Pick<FollowUpEvalSettings, "horaInicio" | "horaFim" | "diasAtivos">,
): Date {
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidate = new Date(now.getTime() + dayOffset * 24 * 60 * 60_000);
    const day = candidate.getUTCDay();
    if (settings.diasAtivos.length === 0 || settings.diasAtivos.includes(day)) {
      const startOfDay = new Date(candidate);
      startOfDay.setUTCHours(settings.horaInicio, 0, 0, 0);
      if (startOfDay > now) return startOfDay;
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60_000);
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

  if (job.attempts >= job.maxAttempts) return { ...base, skipReason: "max_attempts_reached" };

  const leadStatus = lead?.status?.toLowerCase() ?? "";
  if (leadStatus && LOST_STATUSES.has(leadStatus)) {
    return { ...base, skipReason: `lead_status_${leadStatus}` };
  }

  if (conversationState?.humanPaused) {
    return { ...base, humanBlocked: true, skipReason: "human_paused" };
  }
  if (conversationState?.conversationMode === "human") {
    return { ...base, humanBlocked: true, skipReason: "conversation_mode_human" };
  }
  if (conversationState?.archivedAt) {
    return { ...base, skipReason: "conversation_archived" };
  }

  if (ctx.lastCustomerMessageAt && ctx.lastCustomerMessageAt > job.createdAt) {
    return { ...base, skipReason: "customer_replied" };
  }

  const effectiveCooldownMs =
    Math.max(settings.cooldownMinutos, MIN_GLOBAL_COOLDOWN_MINUTES) * 60_000;
  if (lead?.lastFollowUpAt) {
    const timeSinceLast = now.getTime() - lead.lastFollowUpAt.getTime();
    if (timeSinceLast < effectiveCooldownMs) {
      return { ...base, cooldownActive: true, spamRisk: true, skipReason: "cooldown_active" };
    }
  }
  if (lead?.followUpCooldownUntil && lead.followUpCooldownUntil > now) {
    return { ...base, cooldownActive: true, skipReason: "cooldown_until" };
  }

  if (!isWithinBusinessHours(now, settings)) {
    const nextSlot = nextBusinessHourStart(now, settings);
    return {
      ...base,
      businessHoursBlocked: true,
      nextRetryAt: nextSlot,
      skipReason: "outside_business_hours",
    };
  }

  if (ctx.lastHumanOutboundAt) {
    const twoIntervalsMs = settings.intervaloVerificacaoMinutos * 2 * 60_000;
    const timeSinceHuman = now.getTime() - ctx.lastHumanOutboundAt.getTime();
    if (timeSinceHuman < twoIntervalsMs) {
      return { ...base, humanBlocked: true, skipReason: "human_recently_active" };
    }
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

  if (settings.slaHorasResposta) {
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

  if (followUpType === "silence" && ctx.lastHumanOutboundAt) {
    const slaMs = (settings.slaHorasResposta ?? 24) * 3_600_000;
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

  if (job.attempts === 0 && followUpType !== "sla_breach") priority = Math.min(5, priority + 1);
  if (job.attempts >= 2 && priority > 2) priority = priority - 1;

  let adjustedUrgency: FollowUpUrgency = urgency as FollowUpUrgency;
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
  settings: Pick<FollowUpEvalSettings, "modo" | "slaHorasResposta">;
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

  return [
    typeCtx,
    "",
    `Estratégia: ${modeCtx}`,
    "",
    attemptNote,
    "Regras obrigatórias:",
    "- Use o histórico real da conversa para personalizar.",
    "- Nunca use templates genéricos como «Olá, tudo bem?» sem contexto.",
    "- Não revele que é um sistema automático de follow-up.",
    "- Seja breve, natural e humano.",
    `- Nível de urgência: ${decision.urgency}.`,
  ].join("\n");
}
