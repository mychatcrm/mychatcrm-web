import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantTextForSchedulingConfirmation,
  createAgendaEventForSchedulingCta,
  detectRescheduleIntent,
  detectSchedulingConfirmation,
  extractLocationFromText,
  formatExistingAppointmentSchedulingBlock,
  isSchedulingCta,
  parseAgendaDirectives,
  prepareAgendaDirectiveInReply,
  stripAgendaDirectives,
  executeAgendaDirective,
} from "@/lib/server/agent-cta-scheduler";

const insertAgendaEventMock = vi.fn();
const updateAgendaEventMock = vi.fn();
const cancelAgendaEventMock = vi.fn();
const getAgendaEventByIdMock = vi.fn();
const getGoogleCalendarTokenMock = vi.fn();
const createGoogleCalendarEventMock = vi.fn();
const cancelGoogleCalendarEventMock = vi.fn();
const broadcastAgendaChangeMock = vi.fn();

vi.mock("@/lib/server/google-calendar-db", () => ({
  insertAgendaEvent: (...args: unknown[]) => insertAgendaEventMock(...args),
  updateAgendaEvent: (...args: unknown[]) => updateAgendaEventMock(...args),
  cancelAgendaEvent: (...args: unknown[]) => cancelAgendaEventMock(...args),
  getAgendaEventById: (...args: unknown[]) => getAgendaEventByIdMock(...args),
  getGoogleCalendarToken: (...args: unknown[]) => getGoogleCalendarTokenMock(...args),
}));
vi.mock("@/lib/server/google-calendar", () => ({
  createGoogleCalendarEvent: (...args: unknown[]) => createGoogleCalendarEventMock(...args),
  cancelGoogleCalendarEvent: (...args: unknown[]) => cancelGoogleCalendarEventMock(...args),
}));
vi.mock("@/lib/server/agenda-realtime", () => ({
  broadcastAgendaChange: (...args: unknown[]) => broadcastAgendaChangeMock(...args),
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

function makeStructuredSb(existing: Record<string, unknown> | null = null) {
  return {
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          neq: () => chain,
          gte: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () =>
            table === "leads"
              ? { data: { name: "Maria" }, error: null }
              : { data: existing, error: null },
        };
        return chain;
      },
    }),
  } as never;
}

describe("agent-cta-scheduler", () => {
  beforeEach(() => {
    insertAgendaEventMock.mockReset();
    updateAgendaEventMock.mockReset();
    cancelAgendaEventMock.mockReset();
    getAgendaEventByIdMock.mockReset();
    getGoogleCalendarTokenMock.mockReset();
    createGoogleCalendarEventMock.mockReset();
    cancelGoogleCalendarEventMock.mockReset();
    broadcastAgendaChangeMock.mockReset();
    getGoogleCalendarTokenMock.mockResolvedValue(null);
  });

  it("detects scheduling CTA value", () => {
    expect(isSchedulingCta("Agendar no Google Agenda")).toBe(true);
    expect(isSchedulingCta("Transferir para humano")).toBe(false);
  });

  it("parses and strips a structured scheduling directive", () => {
    const text = "Combinado! [[ AGENDAR: data=02/06/2026, hora=14:30, local=Sala 2 ]]";
    expect(parseAgendaDirectives(text)).toEqual({
      directives: [{ type: "schedule", date: "02/06/2026", time: "14:30", location: "Sala 2" }],
      invalid: false,
    });
    expect(stripAgendaDirectives(text)).toBe("Combinado!");
  });

  it("prepares a directive without persisting it before delivery", () => {
    expect(
      prepareAgendaDirectiveInReply({
        text: "Combinado! [[AGENDAR: data=02/06/2099, hora=14:30]]",
        enabled: true,
      }),
    ).toEqual({
      text: "Combinado!",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
      action: "pending",
    });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("strips but blocks agenda directives when automation is disabled", () => {
    expect(
      prepareAgendaDirectiveInReply({
        text: "Combinado! [[AGENDAR: data=02/06/2099, hora=14:30]]",
        enabled: false,
      }),
    ).toEqual({ text: "Combinado!", directive: null, action: "blocked" });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("parses cancellation only with a valid UUID", () => {
    expect(
      parseAgendaDirectives("[[CANCELAR_AGENDA: id=123e4567-e89b-42d3-a456-426614174000]]"),
    ).toEqual({
      directives: [{ type: "cancel", eventId: "123e4567-e89b-42d3-a456-426614174000" }],
      invalid: false,
    });
    expect(parseAgendaDirectives("[[CANCELAR_AGENDA: id=invalido]]").invalid).toBe(true);
  });

  it("parses [[CANCELAR_AGENDA]] without params as auto-cancel", () => {
    expect(parseAgendaDirectives("Cancelado! [[CANCELAR_AGENDA]]")).toEqual({
      directives: [{ type: "cancel", eventId: null }],
      invalid: false,
    });
    expect(stripAgendaDirectives("Cancelado! [[CANCELAR_AGENDA]]")).toBe("Cancelado!");
  });

  it("rejects incomplete, invalid and conflicting directives", () => {
    expect(parseAgendaDirectives("[[AGENDAR: data=31/02/2026, hora=14:30]]").invalid).toBe(true);
    expect(parseAgendaDirectives("[[AGENDAR: data=02/06/2026]]").invalid).toBe(true);
    expect(
      parseAgendaDirectives(
        "[[AGENDAR: data=02/06/2026, hora=14:30]] [[CANCELAR_AGENDA: id=123e4567-e89b-42d3-a456-426614174000]]",
      ).invalid,
    ).toBe(true);
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

  it("creates a structured agenda event locally when Google is disconnected", async () => {
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-new" });
    const result = await executeAgendaDirective({
      sb: makeStructuredSb(),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      leadId: "lead-1",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: "Sala 2" },
    });

    expect(result).toEqual({ action: "scheduled", eventId: "evt-new" });
    expect(insertAgendaEventMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: "t1",
      attendee_phone: "5562999999999",
      location: "Sala 2",
      google_event_id: null,
    }));
  });

  it("creates the remote Google event when the tenant calendar is connected", async () => {
    getGoogleCalendarTokenMock.mockResolvedValueOnce({ tenant_id: "t1" });
    createGoogleCalendarEventMock.mockResolvedValueOnce({ id: "google-1" });
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-new" });

    await executeAgendaDirective({
      sb: makeStructuredSb(),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
    });

    expect(createGoogleCalendarEventMock).toHaveBeenCalledTimes(1);
    expect(insertAgendaEventMock).toHaveBeenCalledWith(expect.objectContaining({ google_event_id: "google-1" }));
  });

  it("does not cancel an event belonging to another phone", async () => {
    getAgendaEventByIdMock.mockResolvedValueOnce({
      id: "123e4567-e89b-42d3-a456-426614174000",
      attendee_phone: "5562888888888",
      google_event_id: null,
    });

    await expect(
      executeAgendaDirective({
        sb: makeStructuredSb(),
        tenantId: "t1",
        remoteJid: "5562999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        directive: { type: "cancel", eventId: "123e4567-e89b-42d3-a456-426614174000" },
      }),
    ).rejects.toThrow("agenda_event_contact_mismatch");
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("auto-cancels next active event when no id provided", async () => {
    const activeEvent = {
      id: "evt-active",
      attendee_phone: "5562999999999",
      google_event_id: null,
      start_at: "2099-06-10T17:00:00.000Z",
    };
    const result = await executeAgendaDirective({
      sb: makeStructuredSb(activeEvent),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      directive: { type: "cancel", eventId: null },
    });
    expect(result).toEqual({ action: "cancelled", eventId: "evt-active" });
    expect(cancelAgendaEventMock).toHaveBeenCalledWith("t1", "evt-active");
  });

  it("throws when auto-cancel finds no active event", async () => {
    await expect(
      executeAgendaDirective({
        sb: makeStructuredSb(null),
        tenantId: "t1",
        remoteJid: "5562999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        directive: { type: "cancel", eventId: null },
      }),
    ).rejects.toThrow("agenda_event_not_found");
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("creates the replacement before cancelling the nearest active event", async () => {
    const existing = {
      id: "evt-old",
      attendee_phone: "5562999999999",
      google_event_id: null,
      start_at: "2099-06-01T13:00:00.000Z",
    };
    insertAgendaEventMock.mockResolvedValueOnce({
      id: "evt-new",
      attendee_phone: "5562999999999",
      google_event_id: null,
    });

    const result = await executeAgendaDirective({
      sb: makeStructuredSb(existing),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
    });

    expect(result).toEqual({ action: "rescheduled", eventId: "evt-new" });
    expect(cancelAgendaEventMock).toHaveBeenCalledWith("t1", "evt-old");
  });
});
