import { describe, expect, it } from "vitest";
import {
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

  it("keeps distinct questions and builds consolidated prompt", () => {
    const burst = normalizeConversationBurst([
      { id: "1", content: "oi" },
      { id: "2", content: "quais lotes vc tem?" },
      { id: "3", content: "e qual valor?" },
      { id: "4", content: "localização?" },
    ]);
    expect(burst.canonicalMessages.length).toBeGreaterThanOrEqual(3);
    expect(burst.userPrompt).not.toMatch(/^\d+\./m);
    expect(burst.signals.dominantIntent).not.toBe("greeting");
    expect(burst.suppressedHistoryIds).toEqual(["1", "2", "3", "4"]);
  });

  it("prioritizes urgency in strategy", () => {
    const burst = normalizeConversationBurst([
      { id: "1", content: "qual localização?" },
      { id: "2", content: "me manda agora por favor" },
    ]);
    expect(burst.signals.urgencyLevel).toBe("high");
    expect(burst.responseStrategy).toBe("urgent_direct");
    expect(burst.userPrompt.toLowerCase()).toContain("agora");
  });
});
