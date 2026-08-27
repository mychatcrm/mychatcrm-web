import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiGenerateInput } from "@/lib/ai/types";
import { AGENDA_DATETIME_NEEDED_REPLY } from "@/lib/server/agent-cta-scheduler";

/**
 * Regressão do incidente real (My Broker Office, 16-17/08/2026): o modelo
 * propôs "15/11/2023" num propose_create — data passada e inválida. Até este fix, isso só era
 * barrado no commit final (insertStructuredAgendaEvent); o cliente já tinha
 * visto a data errada no texto. Aqui cobre a trava nova: validar ANTES de
 * responder, com uma tentativa de correção e um fallback seguro se persistir.
 */

const AGENDA_DISPONIBILIDADE = {
  ativo: true,
  diasSemana: [1, 2, 3, 4, 5],
  horaInicio: "09:00",
  horaFim: "18:00",
};

function structuredResult(overrides: {
  reply: string;
  action: string;
  date: string | null;
  time: string | null;
}) {
  return {
    ok: true as const,
    text: overrides.reply,
    structuredData: {
      reply: overrides.reply,
      agenda: {
        action: overrides.action,
        date: overrides.date,
        time: overrides.time,
        location: overrides.action === "none" || overrides.action === "list" ? null : "Rua Teste, 123",
        eventId: null,
      },
      leadOutcome: { action: "none", reason: null },
      externalApiLookups: [],
    },
    provider: "openai" as const,
    model: "gpt-4o-mini",
    usage: { input: 0, output: 0, total: 0 },
    estimatedCostUsd: 0,
  };
}

const generateAIResponseMock = vi.fn();

vi.mock("@/lib/agents/inference-store", () => ({
  getInferenceProfileByTenantAgent: vi.fn(async () => ({
    tenantId: "tenant-test",
    agentId: "ag-broker",
    displayName: "Agente",
    systemPrompt: "Ajude o cliente a agendar uma entrevista.",
    model: null,
    metadata: {
      instructionMode: "simple",
      simplePrompt: "Ajude o cliente a agendar uma entrevista.",
      agendaAutomationEnabled: true,
      timezone: "America/Sao_Paulo",
      agendaDisponibilidade: AGENDA_DISPONIBILIDADE,
    },
  })),
}));

vi.mock("@/lib/ai/gateway", () => ({
  generateAIResponse: (input: AiGenerateInput) => generateAIResponseMock(input),
}));

describe("generateAgentResponse — trava de data/hora da agenda", () => {
  beforeEach(() => {
    generateAIResponseMock.mockClear();
    // Domingo 16/08/2026 21:41 BRT — mesmo instante do incidente real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-17T00:41:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("corrige sozinho quando a segunda tentativa propõe uma data real", async () => {
    generateAIResponseMock
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Temos um horário disponível na quarta-feira, dia 15, às 14h. Fica bom?",
          action: "propose_create",
          date: "15/11/2023",
          time: "14:00",
        }),
      )
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Temos um horário disponível na segunda-feira, dia 17/08, às 14h. Fica bom?",
          action: "propose_create",
          date: "17/08/2026",
          time: "14:00",
        }),
      );

    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");
    const result = await generateAgentResponse({
      tenantId: "tenant-test",
      agentId: "ag-broker",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Sim" }],
    });

    expect(generateAIResponseMock).toHaveBeenCalledTimes(2);
    const retryInput = generateAIResponseMock.mock.calls[1]![0] as AiGenerateInput;
    const correctionMessage = retryInput.messages.find(
      (message) =>
        message.role === "system" &&
        message.content.includes("TECHNICAL AGENDA CORRECTION"),
    );
    expect(correctionMessage?.content).toContain("TECHNICAL AGENDA CORRECTION");
    expect(correctionMessage?.content).toContain("date=15/11/2023, time=14:00");
    expect(correctionMessage?.content).toContain("Allowed ISO weekdays: 1, 2, 3, 4, 5");
    expect(correctionMessage?.content).toContain("timezone: America/Sao_Paulo");
    expect(correctionMessage?.content).not.toContain("CALENDÁRIO REAL");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.text).not.toContain("15/11/2023");
    expect(result.text).toContain("17/08");
    const structured = result.structuredData as { agenda: { date: string | null } };
    expect(structured.agenda.date).toBe("17/08/2026");
  });

  it("cai num fallback seguro quando as duas tentativas propõem data inválida", async () => {
    generateAIResponseMock
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Temos um horário disponível na quarta-feira, dia 15, às 14h. Fica bom?",
          action: "propose_create",
          date: "15/11/2023",
          time: "14:00",
        }),
      )
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Confirmando: quarta-feira, dia 15, às 14h?",
          action: "propose_create",
          date: "15/11/2023",
          time: "14:00",
        }),
      );

    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");
    const result = await generateAgentResponse({
      tenantId: "tenant-test",
      agentId: "ag-broker",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Sim" }],
    });

    expect(generateAIResponseMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.text).toBe(AGENDA_DATETIME_NEEDED_REPLY);
    const structured = result.structuredData as { agenda: { action: string; date: string | null } };
    expect(structured.agenda.action).toBe("none");
    expect(structured.agenda.date).toBeNull();
  });

  it("não faz segunda chamada quando a agenda não propõe data (fluxo comum)", async () => {
    generateAIResponseMock.mockResolvedValueOnce(
      structuredResult({
        reply: "Olá! Recebemos seu cadastro. Posso te ajudar?",
        action: "none",
        date: null,
        time: null,
      }),
    );

    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");
    const result = await generateAgentResponse({
      tenantId: "tenant-test",
      agentId: "ag-broker",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Oi" }],
    });

    expect(generateAIResponseMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.text).toBe("Olá! Recebemos seu cadastro. Posso te ajudar?");
  });

  it("corrige o incidente real em que o modelo propõe domingo usando action none", async () => {
    generateAIResponseMock
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Temos um horário disponível na quarta-feira, dia 30/08, às 14h. Fica bom?",
          action: "none",
          date: "30/08/2026",
          time: "14:00",
        }),
      )
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Temos um horário disponível na sexta-feira, dia 28/08, às 14h. Fica bom?",
          action: "propose_create",
          date: "28/08/2026",
          time: "14:00",
        }),
      );

    vi.setSystemTime(new Date("2026-08-27T17:05:00.000Z"));
    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");
    const result = await generateAgentResponse({
      tenantId: "tenant-test",
      agentId: "ag-broker",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Pode" }],
    });

    expect(generateAIResponseMock).toHaveBeenCalledTimes(2);
    const retryInput = generateAIResponseMock.mock.calls[1]![0] as AiGenerateInput;
    expect(retryInput.messages.some((message) =>
      message.role === "system" &&
      message.content.includes("agenda_action_payload_mismatch") &&
      message.content.includes("MUST use propose_create or propose_reschedule"),
    )).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.text).toContain("sexta-feira");
    expect(result.text).toContain("28/08");
    const structured = result.structuredData as { agenda: { action: string; date: string | null } };
    expect(structured.agenda).toMatchObject({ action: "propose_create", date: "28/08/2026" });
  });

  it("bloqueia proposta visível se o modelo esconder novamente o slot em action none", async () => {
    generateAIResponseMock
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Posso confirmar para 30/08/2026, às 14h?",
          action: "none",
          date: "30/08/2026",
          time: "14:00",
        }),
      )
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Posso confirmar para 30/08/2026, às 14h?",
          action: "none",
          date: null,
          time: null,
        }),
      );

    vi.setSystemTime(new Date("2026-08-27T17:05:00.000Z"));
    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");
    const result = await generateAgentResponse({
      tenantId: "tenant-test",
      agentId: "ag-broker",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Pode" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.text).toBe(AGENDA_DATETIME_NEEDED_REPLY);
    expect(result.text).not.toContain("30/08");
    const structured = result.structuredData as { agenda: { action: string; date: string | null; time: string | null } };
    expect(structured.agenda).toMatchObject({ action: "none", date: null, time: null });
  });

  it("corrige dia da semana visível que não corresponde à data estruturada", async () => {
    generateAIResponseMock
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Posso confirmar para quarta-feira, 28/08/2026, às 14h?",
          action: "propose_create",
          date: "28/08/2026",
          time: "14:00",
        }),
      )
      .mockResolvedValueOnce(
        structuredResult({
          reply: "Posso confirmar para sexta-feira, 28/08/2026, às 14h?",
          action: "propose_create",
          date: "28/08/2026",
          time: "14:00",
        }),
      );

    vi.setSystemTime(new Date("2026-08-27T17:05:00.000Z"));
    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");
    const result = await generateAgentResponse({
      tenantId: "tenant-test",
      agentId: "ag-broker",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Pode" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.text).toContain("sexta-feira");
    expect(result.text).not.toContain("quarta-feira");
  });
});
