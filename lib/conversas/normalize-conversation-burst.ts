import type { InboundTextMessage } from "@/lib/conversas/inbound-message-dedupe";

export type BurstUrgencyLevel = "low" | "medium" | "high";
export type BurstResponseStrategy = "single_natural";

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

/**
 * A burst is transport context, not business intent. Every accepted inbound in
 * the debounce window belongs to one model turn and one logical response.
 */
export function groupBurstIntoReplyUnits(messages: InboundTextMessage[]): InboundTextMessage[][] {
  return messages.length > 0 ? [messages] : [];
}

/** Preserve the customer's exact language and ordering without adding a script. */
export function buildReplyUnitPrompt(unit: InboundTextMessage[]): string {
  return unit
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");
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

export function normalizeConversationBurst(
  messages: InboundTextMessage[],
  options?: { dedupeEnabled?: boolean; burstMode?: "exact" | "relaxed" },
): NormalizedBurst {
  const dedupeEnabled = options?.dedupeEnabled !== false;
  const burstMode = options?.burstMode ?? "relaxed";
  const originalCount = messages.length;
  const canonicalMessages: InboundTextMessage[] = [];
  const seen = new Map<string, number>();

  for (const message of messages) {
    const raw = message.content.trim();
    if (!dedupeEnabled || !raw) {
      canonicalMessages.push(message);
      continue;
    }

    const key = normalizeBurstDedupeKey(raw, burstMode);
    const previousIndex = seen.get(key);
    if (previousIndex == null) {
      seen.set(key, canonicalMessages.length);
      canonicalMessages.push(message);
      continue;
    }

    // Preserve the most informative spelling while keeping the original slot.
    const previous = canonicalMessages[previousIndex];
    if (previous && raw.length > previous.content.trim().length) {
      canonicalMessages[previousIndex] = message;
    }
  }

  const dedupedCount = Math.max(0, originalCount - canonicalMessages.length);
  const userPrompt = buildReplyUnitPrompt(canonicalMessages);

  return {
    userPrompt,
    canonicalMessages,
    replyUnits: groupBurstIntoReplyUnits(canonicalMessages),
    dedupedCount,
    groupedMessagesCount: canonicalMessages.length,
    suppressedHistoryIds: messages.map((message) => message.id),
    signals: {
      // Deliberately transport-only: content/intent remains owned by the agent prompt.
      dominantIntent: "",
      groupedQuestions: [],
      groupedIntent: "",
      urgencyLevel: "low",
      repeatedMessages: dedupedCount,
      shortTermContext: userPrompt,
    },
    responseStrategy: "single_natural",
  };
}
