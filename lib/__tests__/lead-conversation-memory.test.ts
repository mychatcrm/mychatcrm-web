import { describe, expect, it } from "vitest";
import {
  buildCondensedMemoryContext,
  buildRecognitionHint,
  daysSince,
} from "@/lib/server/lead-conversation-memory";
import { isConversationVisibleInInbox } from "@/lib/server/conversation-visibility";

describe("lead conversation memory", () => {
  it("builds recognition hint for recent conversations with summary", () => {
    const hint = buildRecognitionHint({
      lastInteractionAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      summary: {
        summary: "Cliente pediu tabela de preços",
        customerIntent: "orçamento",
        leadTemperature: "morno",
        suggestedNextAction: "enviar proposta",
        objections: [],
        importantFacts: {},
        createdAt: new Date().toISOString(),
      },
      lead: null,
      hasPriorMessages: true,
    });
    expect(hint).toContain("poucos dias");
    expect(hint).toContain("orçamento");
  });

  it("does not invent recognition without history", () => {
    expect(
      buildRecognitionHint({
        lastInteractionAt: null,
        summary: null,
        lead: null,
        hasPriorMessages: false,
      }),
    ).toBeNull();
  });

  it("condenses CRM memory for prompt", () => {
    const text = buildCondensedMemoryContext({
      lead: {
        id: "lead-1",
        name: "Maria",
        phone: "5511999999999",
        source: "whatsapp",
        status: "contato",
        crmFunnelId: "funil",
        notes: null,
        agentId: "ag-1",
        aiSummary: "Interessada em visita",
        leadTemperature: "quente",
        suggestedNextAction: "agendar visita",
        profileMetadata: {},
      },
      state: null,
      summary: null,
      lastInteractionAt: "2026-05-01T10:00:00.000Z",
    });
    expect(text).toContain("Memória central do CRM");
    expect(text).toContain("Maria");
    expect(text).toContain("Interessada em visita");
  });

  it("calculates days since last interaction", () => {
    const days = daysSince(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });
});

describe("conversation visibility", () => {
  it("hides archived conversations from inbox", () => {
    expect(
      isConversationVisibleInInbox({ isHidden: false, archivedAt: "2026-05-01T00:00:00.000Z" }),
    ).toBe(false);
  });

  it("shows active conversations", () => {
    expect(isConversationVisibleInInbox({ isHidden: false, archivedAt: null })).toBe(true);
  });
});
