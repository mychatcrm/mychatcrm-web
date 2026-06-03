import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENDA_AUTOMATION_DISABLED_REPLY,
  AGENDA_FAILURE_REPLY,
  executeAgendaDirectivesBeforeOutbound,
} from "@/lib/server/agent-cta-scheduler";

const insertAgendaEventMock = vi.fn();
const cancelAgendaEventMock = vi.fn();
const getAgendaEventByIdMock = vi.fn();
const getGoogleCalendarTokenMock = vi.fn();
const createGoogleCalendarEventMock = vi.fn();
const cancelGoogleCalendarEventMock = vi.fn();
const broadcastAgendaChangeMock = vi.fn();

vi.mock("@/lib/server/google-calendar-db", () => ({
  insertAgendaEvent: (...args: unknown[]) => insertAgendaEventMock(...args),
  updateAgendaEvent: vi.fn(),
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

describe("executeAgendaDirectivesBeforeOutbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoogleCalendarTokenMock.mockResolvedValue(null);
    createGoogleCalendarEventMock.mockResolvedValue(null);
    cancelGoogleCalendarEventMock.mockResolvedValue(undefined);
    broadcastAgendaChangeMock.mockResolvedValue(undefined);
    cancelAgendaEventMock.mockResolvedValue(undefined);
  });

  it("executes directive and returns success outbound text", async () => {
    insertAgendaEventMock.mockResolvedValueOnce({
      id: "evt-1",
      attendee_phone: "5511999990000",
      google_event_id: null,
    });

    const onMutationSuccess = vi.fn();
    const result = await executeAgendaDirectivesBeforeOutbound({
      sb: makeStructuredSb(null),
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelTextWithoutHandoff: "Confirmado! [[AGENDAR: data=02/06/2099, hora=14:30]]",
      agendaAutomationEnabled: true,
      lastInboundMessage: "sim, pode confirmar",
      onMutationSuccess,
    });

    expect(result.outboundText).toBe("Confirmado!");
    expect(result.agendaAction).toBe("scheduled");
    expect(onMutationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ action: "scheduled", eventId: "evt-1" }),
    );
  });

  it("returns failure outbound text when directive execution fails", async () => {
    insertAgendaEventMock.mockRejectedValueOnce(new Error("db_down"));

    const result = await executeAgendaDirectivesBeforeOutbound({
      sb: makeStructuredSb(null),
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelTextWithoutHandoff: "Ok! [[AGENDAR: data=02/06/2099, hora=14:30]]",
      agendaAutomationEnabled: true,
      lastInboundMessage: "sim confirmo",
    });

    expect(result.outboundText).toBe(AGENDA_FAILURE_REPLY);
    expect(result.agendaAction).toBe("failed");
  });

  it("returns disabled reply when automation is off but directive is present", async () => {
    const result = await executeAgendaDirectivesBeforeOutbound({
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelTextWithoutHandoff: "Ok! [[AGENDAR: data=02/06/2099, hora=14:30]]",
      agendaAutomationEnabled: false,
    });

    expect(result.outboundText).toBe(AGENDA_AUTOMATION_DISABLED_REPLY);
    expect(result.agendaAction).toBe("none");
  });

  it("passes previousEventId to onMutationSuccess on reschedule", async () => {
    const existing = {
      id: "evt-old",
      attendee_phone: "5511999990000",
      google_event_id: null,
      start_at: "2099-06-01T13:00:00.000Z",
    };
    insertAgendaEventMock.mockResolvedValueOnce({
      id: "evt-new",
      attendee_phone: "5511999990000",
      google_event_id: null,
    });

    const onMutationSuccess = vi.fn();
    await executeAgendaDirectivesBeforeOutbound({
      sb: makeStructuredSb(existing),
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelTextWithoutHandoff: "Remarcado! [[AGENDAR: data=02/06/2099, hora=15:00]]",
      agendaAutomationEnabled: true,
      lastInboundMessage: "sim confirmo",
      onMutationSuccess,
    });

    expect(onMutationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rescheduled",
        eventId: "evt-new",
        previousEventId: "evt-old",
      }),
    );
  });

  it("skips CANCELAR_AGENDA directive without inbound confirmation", async () => {
    const cancelSpy = vi.spyOn(
      await import("@/lib/server/agent-cta-scheduler"),
      "executePreparedAgendaDirective",
    );

    const result = await executeAgendaDirectivesBeforeOutbound({
      sb: makeStructuredSb({
        id: "evt-1",
        attendee_phone: "5511999990000",
        start_at: "2099-06-09T22:00:00.000Z",
      }),
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelTextWithoutHandoff:
        "Entendido! [[CANCELAR_AGENDA: id=123e4567-e89b-42d3-a456-426614174000]]",
      agendaAutomationEnabled: true,
      lastInboundMessage: "quero cancelar meu agendamento",
    });

    expect(result.agendaAction).toBe("none");
    expect(cancelSpy).not.toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it("skips directive execution without inbound confirmation", async () => {
    const executeSpy = vi.spyOn(
      await import("@/lib/server/agent-cta-scheduler"),
      "executePreparedAgendaDirective",
    );

    const result = await executeAgendaDirectivesBeforeOutbound({
      sb: makeStructuredSb(null),
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelTextWithoutHandoff: "Ok! [[AGENDAR: data=02/06/2099, hora=14:30]]",
      agendaAutomationEnabled: true,
      lastInboundMessage: "quero agendar para amanhã às 10h",
    });

    expect(result.agendaAction).toBe("none");
    expect(executeSpy).not.toHaveBeenCalled();
    executeSpy.mockRestore();
  });
});
