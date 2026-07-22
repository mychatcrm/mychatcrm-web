import { describe, expect, it } from "vitest";
import {
  groupBurstIntoReplyUnits,
  normalizeBurstDedupeKey,
  normalizeConversationBurst,
} from "@/lib/conversas/normalize-conversation-burst";

describe("normalizeBurstDedupeKey", () => {
  it("treats case, accents, punctuation and emoji variants as equal in relaxed mode", () => {
    expect(normalizeBurstDedupeKey("Oi")).toBe(normalizeBurstDedupeKey("oi!"));
    expect(normalizeBurstDedupeKey("BOM DIA")).toBe(normalizeBurstDedupeKey("bom   dia"));
    expect(normalizeBurstDedupeKey("café")).toBe(normalizeBurstDedupeKey("cafe"));
    expect(normalizeBurstDedupeKey("oi 👋")).toBe(normalizeBurstDedupeKey("oi"));
  });
});

describe("normalizeConversationBurst", () => {
  it("deduplicates ten oi variants into one message", () => {
    const messages = [
      "oi",
      "Oi",
      "OI",
      "oi!",
      "oi 👋",
      "oi",
      "oi",
      "oi",
      "oi",
      "oi",
    ].map((content, i) => ({ id: `m-${i}`, content }));

    const burst = normalizeConversationBurst(messages);
    expect(burst.canonicalMessages).toHaveLength(1);
    expect(burst.dedupedCount).toBe(9);
    expect(burst.groupedMessagesCount).toBe(1);
  });

  it("groups all burst messages into a single reply unit without classifying a niche", () => {
    const burst = normalizeConversationBurst([
      { id: "1", content: "oi" },
      { id: "2", content: "quais lotes vc tem?" },
      { id: "3", content: "e qual valor?" },
      { id: "4", content: "localização?" },
    ]);
    expect(burst.canonicalMessages.length).toBeGreaterThanOrEqual(3);
    // All messages must be in exactly ONE reply unit — single AI call, single reply
    expect(burst.replyUnits).toHaveLength(1);
    expect(burst.responseStrategy).not.toBe("sequential_replies");
    expect(burst.suppressedHistoryIds).toEqual(["1", "2", "3", "4"]);
    expect(burst.signals.dominantIntent).toBe("");
    expect(burst.userPrompt).toBe("oi\nquais lotes vc tem?\ne qual valor?\nlocalização?");
  });

  it("merges greeting clusters into one reply unit", () => {
    const units = groupBurstIntoReplyUnits([
      { id: "1", content: "oi" },
      { id: "2", content: "tudo bem?" },
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]).toHaveLength(2);
  });

  it("always groups all messages into a single unit (one reply per burst)", () => {
    const units = groupBurstIntoReplyUnits([
      { id: "1", content: "oi" },
      { id: "2", content: "qual o preço?" },
      { id: "3", content: "tem vaga?" },
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]).toHaveLength(3);
  });

  it("preserves arbitrary languages verbatim and keeps one neutral unit", () => {
    const burst = normalizeConversationBurst([
      { id: "1", content: "Please follow my custom instructions." },
      { id: "2", content: "¿Puedes responder las dos preguntas?" },
      { id: "3", content: "Répondez sans changer mon contenu." },
    ]);
    expect(burst.signals.urgencyLevel).toBe("low");
    expect(burst.responseStrategy).toBe("single_natural");
    expect(burst.replyUnits).toHaveLength(1);
    expect(burst.userPrompt).toBe(
      "Please follow my custom instructions.\n¿Puedes responder las dos preguntas?\nRépondez sans changer mon contenu.",
    );
    expect(burst.userPrompt).not.toMatch(/cliente enviou|preço|localização|agendar/i);
  });
});
