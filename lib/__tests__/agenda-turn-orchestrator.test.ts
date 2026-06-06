import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientConfirmedAgendaMutation,
  isStandaloneAgendaConfirmation,
  resolveAgendaTurn,
  shouldDeferHandoffForAgendaResult,
} from "@/lib/server/agent-cta-scheduler";

const insertAgendaEventMock = vi.fn();
const cancelAgendaEventMock = vi.fn();
const getAgendaEventByIdMock = vi.fn();
const getGoogleCalendarTokenMock = vi.fn();
const createGoogleCalendarEventMock = vi.fn();
const cancelGoogleCalendarEventMock = vi.fn();
const broadcastAgendaChangeMock = vi.fn();
const cancelAgendaRemindersForEventMock = vi.fn();
const scheduleAgendaRemindersForEventMock = vi.fn();

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
vi.mock("@/lib/server/agenda-reminder-jobs", () => ({
  cancelAgendaRemindersForEvent: (...args: unknown[]) => cancelAgendaRemindersForEventMock(...args),
  scheduleAgendaRemindersForEvent: (...args: unknown[]) =>
    scheduleAgendaRemindersForEventMock(...args),
}));

const EXISTING_EVENT = {
  id: "evt-existing",
  tenant_id: "tenant-1",
  title: "Agendamento via WhatsApp - Lead",
  start_at: "2026-06-10T17:00:00.000Z",
  end_at: "2026-06-10T18:00:00.000Z",
  status: "pending",
  attendee_phone: "5511999999999",
  attendee_name: "Lead",
  google_event_id: null,
  location: null,
  description: null,
  created_by: "agent",
};

function makeSb(existing: typeof EXISTING_EVENT | null = EXISTING_EVENT) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              gte: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () =>
                      table === "agenda_events" ? { data: existing, error: null } : { data: null, error: null },
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

describe("agenda confirmation helpers", () => {
  it("isStandaloneAgendaConfirmation aceita sim simples", () => {
    expect(isStandaloneAgendaConfirmation("sim")).toBe(true);
    expect(isStandaloneAgendaConfirmation("ok, pode")).toBe(true);
  });

  it("isStandaloneAgendaConfirmation rejeita pedido embutido", () => {
    expect(isStandaloneAgendaConfirmation("sim, quero remarcar para sexta")).toBe(false);
  });

  it("clientConfirmedAgendaMutation exige confirmação real", () => {
    expect(clientConfirmedAgendaMutation("sim", "Posso confirmar para amanhã às 14:00?")).toBe(true);
    expect(clientConfirmedAgendaMutation("quero remarcar", "Posso confirmar?")).toBe(false);
  });
});

describe("resolveAgendaTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoogleCalendarTokenMock.mockResolvedValue(null);
    insertAgendaEventMock.mockImplementation(async (row: { start_at: string }) => ({
      id: "evt-new",
      ...row,
    }));
    cancelAgendaEventMock.mockResolvedValue(undefined);
    cancelAgendaRemindersForEventMock.mockResolvedValue(undefined);
    scheduleAgendaRemindersForEventMock.mockResolvedValue(undefined);
  });

  it("criar sem confirmação não executa", async () => {
    const sb = makeSb(null);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Perfeito! [[AGENDAR: data=10/06/2026, hora=14:00]]",
      clientText: "quero agendar para amanhã às 14",
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("needs_confirmation");
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("criar com confirmação executa", async () => {
    const sb = makeSb(null);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Agendado! [[AGENDAR: data=10/06/2026, hora=14:00]]",
      clientText: "sim",
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("scheduled");
    expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
  });

  it("remarcar com confirmação altera agenda (fallback sem marcador)", async () => {
    const sb = makeSb(EXISTING_EVENT);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Pronto, remarquei seu agendamento para 15/06/2026 às 10:00.",
      clientText: "sim",
      agendaAutomationEnabled: true,
      priorAssistantText: "Posso confirmar a remarcação para 15/06/2026 às 10:00?",
    });
    expect(result.action).toBe("rescheduled");
    expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    expect(cancelAgendaEventMock).toHaveBeenCalledWith("tenant-1", EXISTING_EVENT.id);
  });

  it("cancelar com confirmação cancela (fallback sem marcador)", async () => {
    const sb = makeSb(EXISTING_EVENT);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Seu agendamento foi cancelado.",
      clientText: "sim, pode cancelar",
      agendaAutomationEnabled: true,
      priorAssistantText: "Posso confirmar o cancelamento do seu agendamento?",
    });
    expect(result.action).toBe("cancelled");
    expect(cancelAgendaEventMock).toHaveBeenCalledWith("tenant-1", EXISTING_EVENT.id);
    expect(cancelAgendaRemindersForEventMock).toHaveBeenCalled();
  });

  it("cancelar sem confirmação não executa", async () => {
    const sb = makeSb(EXISTING_EVENT);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Cancelado. [[CANCELAR_AGENDA]]",
      clientText: "quero cancelar meu agendamento",
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("needs_confirmation");
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("agentes sem agenda retornam none", async () => {
    const result = await resolveAgendaTurn({
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Olá, como posso ajudar?",
      clientText: "oi",
      agendaAutomationEnabled: false,
    });
    expect(result.action).toBe("none");
  });

  it("shouldDeferHandoffForAgendaResult adia em falha", () => {
    expect(shouldDeferHandoffForAgendaResult({ text: "", action: "failed" })).toBe(true);
    expect(shouldDeferHandoffForAgendaResult({ text: "", action: "scheduled" })).toBe(false);
  });
});
