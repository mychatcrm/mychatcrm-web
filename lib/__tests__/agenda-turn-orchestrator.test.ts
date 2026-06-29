import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENDA_SUCCESS_REPLY_CANCELLED,
  AGENDA_SUCCESS_REPLY_RESCHEDULED,
  AGENDA_SUCCESS_REPLY_SCHEDULED,
  clientConfirmedAgendaMutation,
  isStandaloneAgendaConfirmation,
  priorAgendaAssistantTextFromMessages,
  resolveAgendaTurn,
  sanitizeAgendaReplyForNoHandoff,
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
    from: (table: string) => {
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { name: "Lead" }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                gte: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () =>
                        table === "agenda_events"
                          ? { data: existing, error: null }
                          : { data: null, error: null },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    },
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

describe("priorAgendaAssistantTextFromMessages", () => {
  it("retorna a última proposta de remarcação do assistente", () => {
    const prior = priorAgendaAssistantTextFromMessages([
      { role: "user", content: "quero remarcar" },
      { role: "assistant", content: "Posso confirmar a remarcação para 15/06/2026 às 10:00?" },
      { role: "user", content: "sim" },
    ]);
    expect(prior).toBe("Posso confirmar a remarcação para 15/06/2026 às 10:00?");
  });

  it("retorna a última proposta de cancelamento do assistente", () => {
    const prior = priorAgendaAssistantTextFromMessages([
      { role: "assistant", content: "Posso confirmar o cancelamento do seu agendamento?" },
      { role: "user", content: "sim" },
    ]);
    expect(prior).toBe("Posso confirmar o cancelamento do seu agendamento?");
  });
});

describe("resolveAgendaTurn", () => {
  beforeEach(() => {
    // Fixa "hoje" antes das datas hardcoded dos testes (10/06 e 15/06/2026) para
    // que continuem sendo futuras — senão o orquestrador (corretamente) recusa
    // agendar no passado e os testes quebram conforme o calendário avança.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:00:00-03:00"));
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

  afterEach(() => {
    vi.useRealTimers();
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
    const conversation = [
      { role: "user", content: "quero remarcar" },
      { role: "assistant", content: "Posso confirmar a remarcação para 15/06/2026 às 10:00?" },
      { role: "user", content: "sim" },
    ];
    const priorAssistantText = priorAgendaAssistantTextFromMessages(conversation);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      leadId: "lead-1",
      timezone: "America/Sao_Paulo",
      modelText: "Pronto, remarquei seu agendamento para 15/06/2026 às 10:00.",
      clientText: "sim",
      priorAssistantText,
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("rescheduled");
    expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    expect(insertAgendaEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        attendee_phone: "5511999999999",
        lead_id: "lead-1",
      }),
    );
    expect(cancelAgendaEventMock).toHaveBeenCalledWith("tenant-1", EXISTING_EVENT.id);
  });

  it("cancelar com confirmação cancela (fallback sem marcador)", async () => {
    const sb = makeSb(EXISTING_EVENT);
    const conversation = [
      { role: "assistant", content: "Posso confirmar o cancelamento do seu agendamento?" },
      { role: "user", content: "sim" },
    ];
    const priorAssistantText = priorAgendaAssistantTextFromMessages(conversation);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      leadId: "lead-1",
      timezone: "America/Sao_Paulo",
      modelText: "Seu agendamento foi cancelado.",
      clientText: "sim",
      priorAssistantText,
      agendaAutomationEnabled: true,
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

  it("remarcar sem confirmação não executa", async () => {
    const sb = makeSb(EXISTING_EVENT);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Perfeito! [[AGENDAR: data=15/06/2026, hora=10:00]]",
      clientText: "quero remarcar para sexta",
      priorAssistantText: "Posso confirmar a remarcação para 15/06/2026 às 10:00?",
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("needs_confirmation");
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("sem priorAssistantText não executa remarcação indevida", async () => {
    const sb = makeSb(EXISTING_EVENT);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Pronto, remarquei seu agendamento para 15/06/2026 às 10:00.",
      clientText: "sim",
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("none");
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
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

  it("turno de proposta de agenda com palavra de handoff adia handoff sem mutar", async () => {
    const sb = makeSb(null);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Posso te encaixar amanhã às 14:00? Confirma?",
      clientText: "quero agendar uma reunião com o especialista",
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("none");
    expect(result.deferHandoff).toBe(true);
    expect(shouldDeferHandoffForAgendaResult(result)).toBe(true);
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("pedido puro de humano sem intenção de agenda não adia handoff", async () => {
    const sb = makeSb(null);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Claro! Já te conecto com um atendente.",
      clientText: "quero falar com atendente",
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("none");
    expect(result.deferHandoff).toBeFalsy();
    expect(shouldDeferHandoffForAgendaResult(result)).toBe(false);
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("após sucesso (scheduled) não adia handoff", async () => {
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
    expect(result.deferHandoff).toBeFalsy();
    expect(shouldDeferHandoffForAgendaResult(result)).toBe(false);
    // scheduled/rescheduled/cancelled nunca adiam handoff
    expect(shouldDeferHandoffForAgendaResult({ text: "", action: "rescheduled" })).toBe(false);
    expect(shouldDeferHandoffForAgendaResult({ text: "", action: "cancelled" })).toBe(false);
  });

  it("Agenda ON funciona sem qualquer sinal de handoff (resolveAgendaTurn não recebe handoff)", async () => {
    const sb = makeSb(null);
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      leadId: "lead-1",
      timezone: "America/Sao_Paulo",
      modelText: "Pronto, agendei para 12/06/2026 às 09:00.",
      clientText: "sim",
      priorAssistantText: "Posso confirmar o agendamento para 12/06/2026 às 09:00?",
      agendaAutomationEnabled: true,
    });
    expect(result.action).toBe("scheduled");
    expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    expect(result.deferHandoff).toBeFalsy();
  });

  describe("Agenda ON + Handoff OFF", () => {
    const handoffOff = { agendaAutomationEnabled: true, ctaHandoffAtivo: false as const };
    const forbiddenHumanWords = ["atendente", "humano", "entrar em contato", "transferir"];

    function expectNoHumanDelegation(text: string) {
      for (const word of forbiddenHumanWords) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }

    it("criar retorna confirmação sem menção a humano", async () => {
      const sb = makeSb(null);
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Agendado! Um atendente humano vai entrar em contato. [[AGENDAR: data=10/06/2026, hora=14:00]]",
        clientText: "sim",
        ...handoffOff,
      });
      expect(result.action).toBe("scheduled");
      expect(result.text).toBe(AGENDA_SUCCESS_REPLY_SCHEDULED);
      expectNoHumanDelegation(result.text);
      expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    });

    it("remarcar funciona com proposta ampla no histórico (sem Posso confirmar)", async () => {
      const sb = makeSb(EXISTING_EVENT);
      const priorAssistantText = "Remarcamos para 15/06/2026 às 10:00, confirma?";
      expect(priorAgendaAssistantTextFromMessages([
        { role: "assistant", content: priorAssistantText },
        { role: "user", content: "sim" },
      ])).toBe(priorAssistantText);
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Pronto, remarcado para 15/06/2026 às 10:00.",
        clientText: "sim",
        priorAssistantText,
        ...handoffOff,
      });
      expect(result.action).toBe("rescheduled");
      expect(result.text).toBe(AGENDA_SUCCESS_REPLY_RESCHEDULED);
      expectNoHumanDelegation(result.text);
      expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
      expect(cancelAgendaEventMock).toHaveBeenCalledWith("tenant-1", EXISTING_EVENT.id);
    });

    it("cancelar funciona com handoff OFF", async () => {
      const sb = makeSb(EXISTING_EVENT);
      const priorAssistantText = "Posso confirmar o cancelamento do seu agendamento?";
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Cancelamento feito.",
        clientText: "sim",
        priorAssistantText,
        ...handoffOff,
      });
      expect(result.action).toBe("cancelled");
      expect(result.text).toBe(AGENDA_SUCCESS_REPLY_CANCELLED);
      expectNoHumanDelegation(result.text);
      expect(cancelAgendaEventMock).toHaveBeenCalledWith("tenant-1", EXISTING_EVENT.id);
    });

    it("sanitiza texto do modelo que menciona humano na proposta", () => {
      const sanitized = sanitizeAgendaReplyForNoHandoff(
        "Perfeito! Um atendente humano vai entrar em contato com você para confirmar.",
      );
      expectNoHumanDelegation(sanitized);
      expect(sanitized.length).toBeGreaterThan(0);
    });

    it("não usa mensagem de delegação humana como proposta válida no histórico", () => {
      const prior = priorAgendaAssistantTextFromMessages([
        {
          role: "assistant",
          content: "Um atendente humano vai entrar em contato com você para confirmar.",
        },
        { role: "user", content: "sim" },
      ]);
      expect(prior).toBeNull();
    });
  });

  describe("Agenda ON + Handoff ON (comportamento preservado)", () => {
    it("criar mantém texto do modelo no sucesso", async () => {
      const sb = makeSb(null);
      const modelText = "Agendado para 10/06 às 14h! [[AGENDAR: data=10/06/2026, hora=14:00]]";
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText,
        clientText: "sim",
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: true,
      });
      expect(result.action).toBe("scheduled");
      expect(result.text).toBe("Agendado para 10/06 às 14h!");
      expect(result.text).not.toBe(AGENDA_SUCCESS_REPLY_SCHEDULED);
    });

    it("remarcar mantém texto do modelo no sucesso", async () => {
      const sb = makeSb(EXISTING_EVENT);
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Pronto, remarquei seu agendamento para 15/06/2026 às 10:00.",
        clientText: "sim",
        priorAssistantText: "Posso confirmar a remarcação para 15/06/2026 às 10:00?",
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: true,
      });
      expect(result.action).toBe("rescheduled");
      expect(result.text).toBe("Pronto, remarquei seu agendamento para 15/06/2026 às 10:00.");
      expect(result.text).not.toBe(AGENDA_SUCCESS_REPLY_RESCHEDULED);
    });
  });
});
