import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantTextForSchedulingConfirmation,
  createAgendaEventForSchedulingCta,
  detectRescheduleIntent,
  detectSchedulingConfirmation,
  extractLocationFromText,
  formatExistingAppointmentSchedulingBlock,
  isSchedulingCta,
} from "@/lib/server/agent-cta-scheduler";

const insertAgendaEventMock = vi.fn();
const updateAgendaEventMock = vi.fn();

vi.mock("@/lib/server/google-calendar-db", () => ({
  insertAgendaEvent: (...args: unknown[]) => insertAgendaEventMock(...args),
  updateAgendaEvent: (...args: unknown[]) => updateAgendaEventMock(...args),
}));

function makeSbNoExisting() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                gte: () => ({
                  ilike: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () =>
                          table === "leads"
                            ? { data: null, error: null }
                            : { data: null, error: null },
                      }),
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

function makeSbWithExisting(existing: Record<string, unknown>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                gte: () => ({
                  ilike: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () =>
                          table === "leads"
                            ? { data: null, error: null }
                            : { data: existing, error: null },
                      }),
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
  beforeEach(() => {
    insertAgendaEventMock.mockReset();
    updateAgendaEventMock.mockReset();
  });

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

  it("detects reschedule intent", () => {
    expect(detectRescheduleIntent("quero remarcar para outro horário")).toBe(true);
    expect(
      detectRescheduleIntent("sim", "Tudo bem, deseja remarcar para qual horário?"),
    ).toBe(true);
  });

  it("extracts location from assistant text", () => {
    expect(
      extractLocationFromText("Visita amanhã às 14h no stand Central Park"),
    ).toContain("stand");
  });

  it("formats existing appointment block", () => {
    const block = formatExistingAppointmentSchedulingBlock(
      {
        id: "e1",
        title: "Agendamento via WhatsApp - Maria",
        start_at: "2026-05-30T17:00:00.000Z",
        end_at: "2026-05-30T18:00:00.000Z",
        status: "pending",
        attendee_name: "Maria",
        location: "Stand A",
        description: null,
      },
      "America/Sao_Paulo",
    );
    expect(block).toContain("CONTEXTO DE AGENDAMENTO");
    expect(block).toContain("remarcar");
  });

  it("creates agenda event when no active duplicate exists", async () => {
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-1" });
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbNoExisting() as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "Confirmado, pode agendar para amanhã às 10:00",
      assistantMessage: "Perfeito, visita amanhã às 10:00 no escritório central.",
      timezone: "America/Sao_Paulo",
      leadId: "lead-1",
      agentId: "agent-1",
    });

    expect(result).toEqual({ created: true, eventId: "evt-1" });
    expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    const payload = insertAgendaEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.tenant_id).toBe("t1");
    expect(payload.lead_id).toBe("lead-1");
    expect(payload.agent_id).toBe("agent-1");
    expect(payload.attendee_name).toBe("Maria");
    expect(payload.created_by).toBe("agent");
  });

  it("returns active_exists when duplicate appointment", async () => {
    const existing = {
      id: "evt-old",
      title: "Agendamento via WhatsApp - Maria",
      start_at: "2026-05-30T17:00:00.000Z",
      end_at: "2026-05-30T18:00:00.000Z",
      status: "pending",
      attendee_name: "Maria",
      location: null,
      description: null,
    };
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbWithExisting(existing) as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "sim",
      assistantMessage: "amanhã às 14h",
      timezone: "America/Sao_Paulo",
    });

    expect(result.created).toBe(false);
    if (!result.created) {
      expect(result.reason).toBe("active_exists");
      expect(result.existing.id).toBe("evt-old");
    }
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("cancels and creates on reschedule", async () => {
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-new" });
    updateAgendaEventMock.mockResolvedValueOnce(undefined);
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbNoExisting() as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "remarcar para amanhã às 15h",
      assistantMessage: "Combinado, amanhã às 15h.",
      timezone: "America/Sao_Paulo",
      rescheduleOfEventId: "evt-old",
    });

    expect(updateAgendaEventMock).toHaveBeenCalledWith("t1", "evt-old", { status: "cancelled" });
    expect(result).toEqual({ created: true, eventId: "evt-new" });
  });

  it("returns unparsed_datetime when no time in messages", async () => {
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbNoExisting() as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "sim",
      assistantMessage: "ótimo!",
      timezone: "America/Sao_Paulo",
    });

    expect(result).toEqual({ created: false, reason: "unparsed_datetime" });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });
});
