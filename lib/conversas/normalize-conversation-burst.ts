import type { InboundTextMessage } from "@/lib/conversas/inbound-message-dedupe";

export type BurstUrgencyLevel = "low" | "medium" | "high";
export type BurstResponseStrategy =
  | "single_natural"
  | "progressive_short"
  | "urgent_direct"
  | "sequential_replies";

export type NormalizedBurst = {
  userPrompt: string;
  canonicalMessages: InboundTextMessage[];
  replyUnits: InboundTextMessage[][];
  dedupedCount: number;
  groupedMessagesCount: number;
  suppressedHistoryIds: string[];
  signals: {
    dominantIntent: string;
    groupedQuestions: string[];
    groupedIntent: string;
    urgencyLevel: BurstUrgencyLevel;
    repeatedMessages: number;
    shortTermContext: string;
  };
  responseStrategy: BurstResponseStrategy;
};

const GREETING_PATTERNS = /^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite|e aí|eai|opa|salve)\b/i;
const PRICE_PATTERNS = /\b(preço|preco|valor|valores|quanto|custa|orçamento|orcamento|investimento)\b/i;
const LOCATION_PATTERNS = /\b(local|localização|localizacao|onde fica|endereço|endereco|região|regiao)\b/i;
const SCHEDULE_PATTERNS = /\b(agendar|agenda|horário|horario|visita|reunião|reuniao|marcar)\b/i;
const HANDOFF_PATTERNS = /\b(humano|atendente|pessoa|falar com|ligar|telefone)\b/i;
const URGENCY_HIGH = /\b(agora|urgente|urgência|urgencia|imediato|já|ja|me manda|me passa|preciso hoje)\b/i;
const URGENCY_MEDIUM = /\b(hoje|rápido|rapido|logo|quanto antes)\b/i;
const SMALL_TALK_FOLLOWUP =
  /^(tudo bem|td bem|como vai|beleza|e você|e vc|tudo certo|como está|como esta)\??$/i;

/** Agrupa todas as mensagens do burst em uma única unidade de resposta.
 *  Todas as mensagens dentro da mesma janela de debounce (Smart Wait) devem
 *  gerar UMA única chamada ao modelo e UMA única mensagem de resposta. */
export function groupBurstIntoReplyUnits(messages: InboundTextMessage[]): InboundTextMessage[][] {
  if (messages.length === 0) return [];
  return [messages];
}

/** Prompt para uma unidade de resposta (1 mensagem ou cluster relacionado). */
export function buildReplyUnitPrompt(unit: InboundTextMessage[]): string {
  const lines = unit.map((m) => m.content.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  if (lines.length === 1) return lines[0]!;
  return `O cliente enviou em sequência: ${lines.map((l) => `"${l}"`).join(" e ")}.`;
}

/** Chave de dedupe: acentos, pontuação final e emojis removidos da comparação. */
export function normalizeBurstDedupeKey(text: string, mode: "exact" | "relaxed" = "relaxed"): string {
  let value = text.trim().toLowerCase();
  if (mode === "relaxed") {
    value = value.normalize("NFD").replace(/\p{M}/gu, "");
    value = value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
    value = value.replace(/[!?.,…:;]+$/g, "").trim();
  }
  return value.replace(/\s+/g, " ");
}

function classifyIntent(text: string): string {
  const key = normalizeBurstDedupeKey(text);
  if (!key) return "empty";
  if (GREETING_PATTERNS.test(key)) return "greeting";
  if (HANDOFF_PATTERNS.test(key)) return "handoff";
  if (PRICE_PATTERNS.test(key)) return "price";
  if (LOCATION_PATTERNS.test(key)) return "location";
  if (SCHEDULE_PATTERNS.test(key)) return "scheduling";
  if (key.includes("?")) return "question";
  return "generic";
}

function scoreUrgency(texts: string[]): BurstUrgencyLevel {
  const blob = texts.join(" ");
  const key = normalizeBurstDedupeKey(blob);
  if (URGENCY_HIGH.test(key)) return "high";
  if (URGENCY_MEDIUM.test(key)) return "medium";
  return "low";
}

function pickDominantIntent(intents: string[]): string {
  const priority = ["handoff", "price", "location", "scheduling", "question", "generic", "greeting"];
  for (const p of priority) {
    if (intents.includes(p)) return p;
  }
  return intents[intents.length - 1] ?? "generic";
}

function buildHumanPrompt(messages: InboundTextMessage[], dominantIntent: string, urgency: BurstUrgencyLevel): string {
  const lines = messages.map((m) => m.content.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  if (lines.length === 1) return lines[0]!;

  const nonGreeting = lines.filter((line) => classifyIntent(line) !== "greeting");
  const substantive = nonGreeting.length ? nonGreeting : lines;

  if (substantive.length === 1) return substantive[0]!;

  if (urgency === "high") {
    const urgentLine = [...substantive].reverse().find((line) => URGENCY_HIGH.test(normalizeBurstDedupeKey(line)));
    const rest = substantive.filter((l) => l !== urgentLine);
    if (urgentLine && rest.length) {
      return `O cliente enviou várias mensagens em sequência. Prioridade imediata: "${urgentLine}". Também perguntou: ${rest.map((r) => `"${r}"`).join(", ")}. Responda de forma natural e única, sem listar FAQ.`;
    }
  }

  if (dominantIntent === "price" || dominantIntent === "location") {
    return `O cliente enviou em sequência: ${substantive.map((l) => `"${l}"`).join(", ")}. Interprete como um único pedido relacionado e responda de forma natural e consolidada, sem repetir apresentação.`;
  }

  return `O cliente enviou as seguintes mensagens em sequência: ${substantive.map((l) => `"${l}"`).join(", ")}. Responda de forma natural e humana, consolidando todas as dúvidas em uma única resposta coerente. Não responda pergunta por pergunta de forma robótica.`;
}

function pickResponseStrategy(
  messageCount: number,
  _unitCount: number,
  urgency: BurstUrgencyLevel,
): BurstResponseStrategy {
  if (urgency === "high") return "urgent_direct";
  if (messageCount <= 2) return "single_natural";
  return "progressive_short";
}

export function normalizeConversationBurst(
  messages: InboundTextMessage[],
  options?: { dedupeEnabled?: boolean; burstMode?: "exact" | "relaxed" },
): NormalizedBurst {
  const dedupeEnabled = options?.dedupeEnabled !== false;
  const burstMode = options?.burstMode ?? "relaxed";
  const originalCount = messages.length;

  const seen = new Map<string, InboundTextMessage>();
  const ordered: InboundTextMessage[] = [];

  for (const message of messages) {
    const raw = message.content.trim();
    if (!raw) {
      ordered.push(message);
      continue;
    }
    const key = normalizeBurstDedupeKey(raw, burstMode);
    if (!dedupeEnabled) {
      ordered.push(message);
      continue;
    }
    const prev = seen.get(key);
    if (prev && raw.length <= prev.content.trim().length) continue;
    seen.set(key, message);
  }

  if (dedupeEnabled) {
    const dedupedList = [...seen.values()].sort(
      (a, b) =>
        messages.findIndex((m) => m.id === a.id) - messages.findIndex((m) => m.id === b.id),
    );
    ordered.length = 0;
    ordered.push(...dedupedList);
  }

  const dedupedCount = Math.max(0, originalCount - ordered.length);
  const intents = ordered.map((m) => classifyIntent(m.content));
  const groupedQuestions = ordered
    .filter((m) => classifyIntent(m.content) === "question" || m.content.includes("?"))
    .map((m) => m.content.trim());
  const dominantIntent = pickDominantIntent(intents);
  const urgencyLevel = scoreUrgency(ordered.map((m) => m.content));
  const groupedIntent = dominantIntent;
  const replyUnits = groupBurstIntoReplyUnits(ordered);
  const userPrompt = buildHumanPrompt(ordered, dominantIntent, urgencyLevel);
  const responseStrategy = pickResponseStrategy(ordered.length, replyUnits.length, urgencyLevel);

  return {
    userPrompt,
    canonicalMessages: ordered,
    replyUnits,
    dedupedCount,
    groupedMessagesCount: ordered.length,
    suppressedHistoryIds: messages.map((m) => m.id),
    signals: {
      dominantIntent,
      groupedQuestions,
      groupedIntent,
      urgencyLevel,
      repeatedMessages: dedupedCount,
      shortTermContext: ordered.map((m) => m.content.trim()).filter(Boolean).join(" | "),
    },
    responseStrategy,
  };
}
