import { describe, expect, it } from "vitest";
import {
  buildCondensedMemoryContext,
  buildRecognitionHint,
  daysSince,
  isolateLeadContextForJourney,
} from "@/lib/server/lead-conversation-memory";
import { isConversationVisibleInInbox } from "@/lib/server/conversation-visibility";

describe("lead conversation memory", () => {
  it("trata interação de minutos atrás como continuação, não nova retomada", () => {
    const hint = buildRecognitionHint({
      lastInteractionAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      summary: null,
      lead: null,
      hasPriorMessages: true,
    });
    expect(hint).toContain("Conversa em andamento");
    expect(hint).toContain("Não cumprimente de novo");
    expect(hint).not.toContain("Retomada de conversa");
  });

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

  it("cita a última mensagem do próprio agente quando ela existe e é recente — prioridade sobre o roteiro do prompt", () => {
    // Reproduz o bug real: uma campanha manda a abertura, o lead responde
    // algo neutro ("boa tarde"), e o agente não pode repetir a mesma abertura
    // só porque o prompt dele tem um exemplo de "primeira mensagem".
    const hint = buildRecognitionHint({
      lastInteractionAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      summary: null,
      lead: null,
      hasPriorMessages: true,
      lastAssistantMessage: {
        content: "Oi, Fulano! Você deixou um cadastro há um tempo. Ainda tem interesse em conhecer melhor?",
        createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    });
    expect(hint).toContain("PRIORIDADE MÁXIMA");
    expect(hint).toContain("Oi, Fulano! Você deixou um cadastro há um tempo");
    expect(hint).toContain("prioridade sobre esse exemplo");
    expect(hint).not.toContain("Conversa em andamento: o cliente já está falando");
  });

  it("sem mensagem própria recente, cai no aviso genérico de continuidade", () => {
    const hint = buildRecognitionHint({
      lastInteractionAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      summary: null,
      lead: null,
      hasPriorMessages: true,
      lastAssistantMessage: null,
    });
    expect(hint).toContain("Conversa em andamento");
    expect(hint).not.toContain("PRIORIDADE MÁXIMA");
  });

  it("corta a mensagem citada pra não inflar o prompt com uma mensagem gigante", () => {
    const hint = buildRecognitionHint({
      lastInteractionAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      summary: null,
      lead: null,
      hasPriorMessages: true,
      lastAssistantMessage: { content: "x".repeat(1000), createdAt: new Date().toISOString() },
    });
    // A citação em si fica em até 400 chars — não os 1000 originais.
    expect(hint?.match(/x+/)?.[0]).toHaveLength(400);
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

  it("includes Meta form facts in condensed CRM memory", () => {
    const text = buildCondensedMemoryContext({
      lead: {
        id: "lead-1",
        name: "Renato",
        phone: "5562993580574",
        source: "lead_ads",
        status: "contato",
        crmFunnelId: null,
        notes: null,
        agentId: "ag-1",
        aiSummary: null,
        leadTemperature: null,
        suggestedNextAction: null,
        profileMetadata: {
          source: "lead_ads",
          form_fields: [{ key: "interesse", label: "Interesse", value: "Apartamento" }],
        },
      },
      state: null,
      summary: null,
      lastInteractionAt: null,
    });
    expect(text).toContain("FORMULÁRIO META");
    expect(text).toContain("Interesse");
  });

  it("calculates days since last interaction", () => {
    const days = daysSince(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });

  it("isolates global CRM narrative when a new journey is explicit", () => {
    const isolated = isolateLeadContextForJourney(
      {
        id: "lead-1",
        name: "Sofia",
        phone: "5562999999999",
        source: "lead_ads",
        status: "novo",
        crmFunnelId: "funil-1",
        notes: "Oferta antiga de outro produto",
        agentId: "agent-new",
        aiSummary: "Cliente queria comprar outro produto",
        leadTemperature: "quente",
        suggestedNextAction: "Enviar oferta antiga",
        profileMetadata: { form_fields: [{ label: "Interesse antigo", value: "Outro produto" }] },
      },
      "journey-new",
      {
        source: "lead_ads",
        form_fields: [{ key: "nome", label: "Nome", value: "Sofia" }],
      },
    );

    expect(isolated?.name).toBe("Sofia");
    expect(isolated?.crmFunnelId).toBe("funil-1");
    expect(isolated?.notes).toBeNull();
    expect(isolated?.aiSummary).toBeNull();
    expect(isolated?.suggestedNextAction).toBeNull();
    expect(isolated?.profileMetadata).toEqual({
      source: "lead_ads",
      form_fields: [{ key: "nome", label: "Nome", value: "Sofia" }],
    });
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
