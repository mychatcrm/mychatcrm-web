export type AgentSmartWaitSettings = {
  enabled: boolean;
  initialSeconds: number;
  followupSeconds: number;
  maxSeconds: number;
  dedupeRepeated: boolean;
};

export const DEFAULT_AGENT_SMART_WAIT: AgentSmartWaitSettings = {
  enabled: true,
  initialSeconds: 7,
  followupSeconds: 10,
  maxSeconds: 60,
  dedupeRepeated: true,
};

const EVOLUTION_SERIAL_DELIVERY_GRACE_SECONDS = 65;
const EVOLUTION_BURST_MAX_SECONDS = 180;

export type EvolutionInboundWaitSignal = {
  kind: "text" | "audio" | "image" | "video" | "document";
  text?: string | null;
  hasPendingAgendaAction?: boolean;
};

const EVOLUTION_SHORT_AMBIGUOUS_RE =
  /^(?:oi|ol[aá]|opa|eai|e a[ií]|sim|s|ok|okay|pode|certo|isso|exato|beleza|obrigad[oa]|valeu|at[eé]\s+mais|bom\s+dia|boa\s+tarde|boa\s+noite)[.!?\s]*$/i;
const EVOLUTION_DATE_ONLY_RE =
  /^(?:pode\s+ser\s+)?(?:hoje|amanh[ãa]|depois\s+de\s+amanh[ãa]|dia\s+\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)[.!?\s]*$/i;
const EVOLUTION_TIME_ONLY_RE =
  /^(?:[aàá]s?\s+)?(?:\d{1,2}(?::\d{2}|h(?:\d{2})?)|uma|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s*(?:horas?|da\s+manh[ãa]|da\s+tarde|da\s+noite))?[.!?\s]*$/i;
const EVOLUTION_INCOMPLETE_END_RE =
  /\b(?:e|ou|as|[aàá]s|para|pra|no|na|em|que|porque|com|sem|de|do|da)\s*[,.!?-]*$/i;
const EVOLUTION_CANCEL_ACTION_RE =
  /\b(?:cancelar|cancelamento|desmarcar)\b/i;
const EVOLUTION_SCHEDULE_ACTION_RE =
  /\b(?:remarcar|reagendar|agendar|marcar|alterar\s+(?:o\s+)?agendamento)\b/i;
const EVOLUTION_DATE_HINT_RE =
  /\b(?:hoje|amanha|depois\s+de\s+amanha|dia\s+\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/i;
const EVOLUTION_TIME_HINT_RE =
  /\b(?:as?\s+)?(?:\d{1,2}(?::\d{2}|h(?:\d{2})?)|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s*(?:horas?|da\s+manha|da\s+tarde|da\s+noite))?\b/i;

/**
 * Decide se a PRIMEIRA mensagem precisa da janela longa da Evolution.
 * Follow-ups sempre usam o tempo curto configurado: quando o complemento
 * finalmente chega, não adicionamos mais um minuto antes de responder.
 */
export function evolutionInboundNeedsExtendedInitialWait(
  signal: EvolutionInboundWaitSignal,
): boolean {
  if (signal.kind !== "text") return true;
  const text = signal.text?.trim() ?? "";
  const foldedText = text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!text) return true;
  if (signal.hasPendingAgendaAction) return false;
  if (EVOLUTION_CANCEL_ACTION_RE.test(text)) return false;
  if (EVOLUTION_SCHEDULE_ACTION_RE.test(text)) {
    // Criação/remarcação só é completa quando o mesmo turno já contém data e
    // hora. "Quero agendar amanhã" ainda pode receber "às 14h" com atraso.
    return !(EVOLUTION_DATE_HINT_RE.test(foldedText) && EVOLUTION_TIME_HINT_RE.test(foldedText));
  }
  if (EVOLUTION_SHORT_AMBIGUOUS_RE.test(text)) return true;
  if (EVOLUTION_DATE_ONLY_RE.test(text) || EVOLUTION_TIME_ONLY_RE.test(text)) return true;
  if (EVOLUTION_INCOMPLETE_END_RE.test(text)) return true;
  return false;
}

/**
 * A fila QR da Evolution pode entregar fragmentos enviados no mesmo segundo
 * com cerca de 60 s entre webhooks. Mantemos o turno aberto somente nesse
 * transporte; Meta Cloud e os demais canais preservam o Smart Wait curto.
 */
export function evolutionBurstSafeSmartWait(
  settings: AgentSmartWaitSettings,
  signal?: EvolutionInboundWaitSignal,
): AgentSmartWaitSettings {
  const extendedInitial = signal
    ? evolutionInboundNeedsExtendedInitialWait(signal)
    : true;
  return {
    ...settings,
    enabled: true,
    initialSeconds: extendedInitial
      ? Math.max(settings.initialSeconds, EVOLUTION_SERIAL_DELIVERY_GRACE_SECONDS)
      : settings.initialSeconds,
    // O primeiro fragmento absorve a entrega serial. Depois que qualquer
    // complemento chega, o silêncio curto configurado já encerra o burst.
    followupSeconds: settings.followupSeconds,
    maxSeconds: extendedInitial
      ? Math.max(settings.maxSeconds, EVOLUTION_BURST_MAX_SECONDS)
      : settings.maxSeconds,
  };
}

function clampSeconds(value: unknown, fallback: number, min = 1, max = 120): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function sanitizeAgentSmartWaitSettings(
  input?: Partial<AgentSmartWaitSettings> | Record<string, unknown> | null,
): AgentSmartWaitSettings {
  const src = input ?? {};
  return {
    // Agrupar mensagens do mesmo burst é uma garantia do pipeline. O campo
    // legado permanece no tipo/metadata para compatibilidade, mas não pode
    // desativar a consistência do turno.
    enabled: true,
    initialSeconds: clampSeconds(src.initialSeconds, DEFAULT_AGENT_SMART_WAIT.initialSeconds, 1, 60),
    followupSeconds: clampSeconds(src.followupSeconds, DEFAULT_AGENT_SMART_WAIT.followupSeconds, 1, 120),
    maxSeconds: clampSeconds(src.maxSeconds, DEFAULT_AGENT_SMART_WAIT.maxSeconds, 5, 180),
    dedupeRepeated: src.dedupeRepeated !== false,
  };
}

export function smartWaitFromMetadata(metadata: Record<string, unknown> | null | undefined): AgentSmartWaitSettings {
  if (!metadata) return { ...DEFAULT_AGENT_SMART_WAIT };
  return sanitizeAgentSmartWaitSettings({
    enabled: metadata.smartWaitEnabled,
    initialSeconds: metadata.smartWaitInitialSeconds,
    followupSeconds: metadata.smartWaitFollowupSeconds,
    maxSeconds: metadata.smartWaitMaxSeconds,
    dedupeRepeated: metadata.smartWaitDedupeRepeated,
  });
}

export function smartWaitToMetadata(settings: AgentSmartWaitSettings): Record<string, unknown> {
  const s = sanitizeAgentSmartWaitSettings(settings);
  return {
    smartWaitEnabled: s.enabled,
    smartWaitInitialSeconds: s.initialSeconds,
    smartWaitFollowupSeconds: s.followupSeconds,
    smartWaitMaxSeconds: s.maxSeconds,
    smartWaitDedupeRepeated: s.dedupeRepeated,
  };
}
