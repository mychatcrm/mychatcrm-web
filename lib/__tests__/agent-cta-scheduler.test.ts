import { describe, expect, it, vi } from "vitest";
import {
  assistantTextForSchedulingConfirmation,
  createAgendaEventForSchedulingCta,
  detectSchedulingConfirmation,
  isSchedulingCta,
} from "@/lib/server/agent-cta-scheduler";

const insertAgendaEventMock = vi.fn();

vi.mock("@/lib/server/google-calendar-db", () => ({
  insertAgendaEvent: (...args: unknown[]) => insertAgendaEventMock(...args),
}));

function makeSbNoExisting() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                ilike: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown;
}

describe("agent-cta-scheduler", () => {
  it("detects scheduling CTA value", () => {
    expect(isSchedulingCta("Agendar no Google Agenda")).toBe(true);
    expect(isSchedulingCta("Transferir para humano")).toBe(false);
  });

  it("detects confirmation intent with scheduling context", () => {
    expect(detectSchedulingConfirmation("Perfeito, pode agendar para amanhã às 14:30")).toBe(true);
    expect(detectSchedulingConfirmation("Quero saber mais sobre o serviço")).toBe(false);
  });

  it("webhook scenario: lead says sim after agent proposed a schedule", () => {
    const priorProposal = "Posso agendar sua visita para amanhã às 14h no nosso stand?";
    const modelReply = "Ótimo, confirmado!";
    expect(
      detectSchedulingConfirmation(
        "sim",
        assistantTextForSchedulingConfirmation(modelReply, priorProposal),
      ),
    ).toBe(true);
  });

  it("detects short confirmation when prior assistant message had scheduling context", () => {
    expect(
      detectSchedulingConfirmation(
        "Está sim!",
        assistantTextForSchedulingConfirmation("Ótimo, confirmado!", "Visita amanhã às 14h no stand"),
      ),
    ).toBe(true);
  });

  it("prefers current assistant text when it already has scheduling context", () => {
    expect(
      assistantTextForSchedulingConfirmation(
        "Agendamento confirmado para amanhã às 14:30",
        "Visita na segunda",
      ),
    ).toBe("Agendamento confirmado para amanhã às 14:30");
  });

  it("creates agenda event when no recent duplicate exists", async () => {
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-1" });
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbNoExisting() as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "Confirmado, pode agendar para amanhã às 10:00",
      assistantMessage: "Perfeito, vou organizar seu agendamento.",
    });

    expect(result).toEqual({ created: true, eventId: "evt-1" });
    expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    const payload = insertAgendaEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.tenant_id).toBe("t1");
    expect(payload.title).toContain("Agendamento via WhatsApp");
    expect(payload.created_by).toBe("agent");
  });
});
