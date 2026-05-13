import { describe, expect, it } from "vitest";
import {
  buildDeterministicHandoffSummary,
  conversationMessagesToAi,
  shouldTriggerHandoff,
} from "@/lib/server/conversation-memory";

describe("conversation-memory helpers", () => {
  it("detects handoff requests from default and custom keywords", () => {
    expect(shouldTriggerHandoff("Quero falar com um atendente agora").trigger).toBe(true);
    expect(shouldTriggerHandoff("preciso de orçamento premium", ["orçamento premium"]).trigger).toBe(true);
    expect(shouldTriggerHandoff("só queria saber o horário").trigger).toBe(false);
  });

  it("converts canonical WhatsApp history into AI messages without human-only messages", () => {
    expect(
      conversationMessagesToAi([
        { role: "user", content: "Oi", kind: "text", createdAt: "2026-05-13T10:00:00.000Z" },
        { role: "assistant", content: "Olá!", kind: "text", createdAt: "2026-05-13T10:01:00.000Z" },
        { role: "human", content: "Assumi", kind: "text", createdAt: "2026-05-13T10:02:00.000Z" },
      ]),
    ).toEqual([
      { role: "user", content: "Oi" },
      { role: "assistant", content: "Olá!" },
    ]);
  });

  it("builds a safe deterministic handoff summary from recent user messages", () => {
    const summary = buildDeterministicHandoffSummary({
      lead: {
        id: "lead-1",
        name: "Maria",
        phone: "5511999990000",
        source: "whatsapp",
        status: "contato",
        crmFunnelId: "funil-default",
        notes: null,
        agentId: "ag-vendas",
        aiSummary: null,
        leadTemperature: null,
        suggestedNextAction: null,
        profileMetadata: {},
      },
      messages: [
        { role: "user", content: "Quero proposta hoje", kind: "text", createdAt: "2026-05-13T10:00:00.000Z" },
      ],
      reason: "proposta",
    });

    expect(summary.summary).toContain("Maria");
    expect(summary.customerIntent).toBe("Quero proposta hoje");
    expect(summary.leadTemperature).toBe("quente");
    expect(summary.suggestedNextAction).toContain("Atendente humano");
  });
});
