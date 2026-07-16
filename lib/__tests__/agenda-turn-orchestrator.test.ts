import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENDA_AUTOMATION_DISABLED_REPLY,
  AGENDA_DATETIME_NEEDED_REPLY,
  AGENDA_FAILURE_REPLY_NO_HANDOFF,
  AGENDA_SLOT_TAKEN_REPLY,
  AGENDA_SUCCESS_REPLY_CANCELLED,
  AGENDA_SUCCESS_REPLY_RESCHEDULED,
  AGENDA_SUCCESS_REPLY_SCHEDULED,
  AGENDA_UNVERIFIED_CLAIM_REPLY,
  buildOutsideAvailabilityReply,
  clientConfirmedAgendaMutation,
  isInitialAgendaMutationRequest,
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

/** Chain flexível (aceita lt/gt da query de conflito) para os testes de janela/ocupação. */
function makeFlexSb(options: {
  existing?: typeof EXISTING_EVENT | null;
  conflictRow?: Record<string, unknown> | null;
} = {}) {
  return {
    from: (table: string) => ({
      select: () => {
        let usedOverlap = false;
        const chain = {
          eq: () => chain,
          neq: () => chain,
          gte: () => chain,
          lt: () => {
            usedOverlap = true;
            return chain;
          },
          gt: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (table === "leads") return { data: { name: "Lead" }, error: null };
            if (usedOverlap) return { data: options.conflictRow ?? null, error: null };
            return { data: options.existing ?? null, error: null };
          },
        };
        return chain;
      },
    }),
  } as unknown;
}

function makeStructuredSb(options: {
  pending?: Record<string, unknown> | null;
} = {}) {
  const pendingRows: Record<string, unknown>[] = options.pending ? [{ ...options.pending }] : [];
  const rpc = vi.fn().mockImplementation(async (name: string) => {
    if (name !== "apply_agent_agenda_mutation") return { data: null, error: null };
    return {
      data: {
        action: "scheduled",
        event: {
          ...EXISTING_EVENT,
          id: "evt-structured",
          start_at: "2026-06-10T17:00:00.000Z",
          end_at: "2026-06-10T18:00:00.000Z",
          agent_id: "agent-1",
        },
        previous_event: null,
        changed: false,
        deduplicated: true,
        operation_status: "local_committed",
      },
      error: null,
    };
  });

  const sb = {
    rpc,
    from: (table: string) => {
      if (table === "agent_agenda_pending_actions") {
        const state: { patch?: Record<string, unknown>; insert?: Record<string, unknown> } = {};
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = async () => ({ data: pendingRows[0] ?? null, error: null });
        chain.insert = (row: Record<string, unknown>) => {
          state.insert = row;
          pendingRows.push({ id: "pending-1", ...row });
          return Promise.resolve({ error: null });
        };
        chain.update = (row: Record<string, unknown>) => {
          state.patch = row;
          if (pendingRows[0]) Object.assign(pendingRows[0], row);
          return chain;
        };
        chain.then = (resolve: (value: { data: null; error: null }) => unknown) =>
          resolve({ data: null, error: null });
        return chain;
      }
      if (table === "agenda_mutation_operations" || table === "agenda_sync_outbox") {
        const chain: Record<string, unknown> = {};
        chain.update = () => chain;
        chain.eq = () => chain;
        chain.neq = () => chain;
        chain.then = (resolve: (value: { data: null; error: null }) => unknown) =>
          resolve({ data: null, error: null });
        return chain;
      }
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { name: "Lead" }, error: null }) }),
          }),
        };
      }
      throw new Error(`unexpected structured table ${table}`);
    },
  } as never;

  return { sb, rpc, pendingRows };
}

describe("agenda confirmation helpers", () => {
  it("isStandaloneAgendaConfirmation aceita sim simples", () => {
    expect(isStandaloneAgendaConfirmation("sim")).toBe(true);
    expect(isStandaloneAgendaConfirmation("ok, pode")).toBe(true);
  });

  it("isStandaloneAgendaConfirmation rejeita pedido embutido", () => {
    expect(isStandaloneAgendaConfirmation("sim, quero remarcar para sexta")).toBe(false);
  });

  it("reconhece 'pode agendar' como ordem, não confirmação solta", () => {
    expect(isInitialAgendaMutationRequest("Pode agendar amanhã às duas horas")).toBe(true);
    expect(isStandaloneAgendaConfirmation("Pode agendar amanhã às duas horas")).toBe(false);
  });

  it("clientConfirmedAgendaMutation exige confirmação real", () => {
    expect(clientConfirmedAgendaMutation("sim", "Posso confirmar para amanhã às 14:00?")).toBe(true);
    expect(clientConfirmedAgendaMutation("quero remarcar", "Posso confirmar?")).toBe(false);
  });

  it("pergunta irritada com palavra solta de confirmação NÃO confirma", () => {
    expect(clientConfirmedAgendaMutation("ta ficando doido?", "Posso confirmar para sexta às 14:00?")).toBe(false);
    expect(clientConfirmedAgendaMutation("pode ser as 14 de sexta", "Temos sexta às 14h, pode ser?")).toBe(true);
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

  it("reconhece proposta concreta agnóstica de nicho da conversa real", () => {
    const text =
      "Desculpe pela confusão anterior! Vou registrar sua visita para amanhã, dia 16/07, às 14h na My Broker Office. Confirme se está tudo certo!";
    const prior = priorAgendaAssistantTextFromMessages(
      [
        { role: "user", content: "16/07 às 14:00" },
        { role: "assistant", content: text },
        { role: "user", content: "Confirmado" },
      ],
      "America/Sao_Paulo",
    );
    expect(prior).toBe(text);
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

  it("toggle desligado substitui promessa verbal por resposta segura", async () => {
    const result = await resolveAgendaTurn({
      sb: makeSb(null),
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Pronto, remarquei seu atendimento para sexta às 14h.",
      clientText: "sim",
      agendaAutomationEnabled: false,
    });

    expect(result).toMatchObject({
      action: "blocked",
      text: AGENDA_AUTOMATION_DISABLED_REPLY,
    });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("toggle desligado bloqueia pedido de mutação mesmo sem marcador do modelo", async () => {
    const result = await resolveAgendaTurn({
      sb: makeSb(null),
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Qual data seria melhor para você?",
      clientText: "quero cancelar meu agendamento",
      agendaAutomationEnabled: false,
    });

    expect(result.action).toBe("blocked");
    expect(result.text).toBe(AGENDA_AUTOMATION_DISABLED_REPLY);
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("toggle desligado mantém consulta de agenda sem mutação", async () => {
    const result = await resolveAgendaTurn({
      sb: makeSb(null),
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Seu próximo compromisso é sexta às 14h.",
      clientText: "quando é meu próximo compromisso?",
      agendaAutomationEnabled: false,
    });

    expect(result).toEqual({
      action: "none",
      text: "Seu próximo compromisso é sexta às 14h.",
    });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  describe("plano estruturado da agenda", () => {
    it("executa uma ordem direta e completa sem pedir confirmação redundante", async () => {
      const { sb, rpc } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Vou registrar esse horário.",
        clientText: "Agende 10/06/2026 às 14:00",
        agendaAutomationEnabled: true,
        agendaPlan: {
          action: "create",
          date: "10/06/2026",
          time: "14:00",
          location: null,
          eventId: null,
        },
        operationKey: "agent-response-job:turn-1:1:0",
      });

      expect(result).toMatchObject({
        action: "scheduled",
        text: "Pronto, ficou agendado para 10/06/2026, às 14h.",
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    });

    it("persiste uma proposta e aguarda um sim antes de alterar a agenda", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Posso confirmar esse horário?",
        clientText: "Qual horário você tem disponível?",
        agendaAutomationEnabled: true,
        agendaPlan: {
          action: "propose_create",
          date: "10/06/2026",
          time: "14:00",
          location: null,
          eventId: null,
        },
        operationKey: "agent-response-job:turn-2:1:0",
      });

      expect(result.action).toBe("needs_confirmation");
      expect(result.text).toContain("10/06/2026, às 14h");
      expect(pendingRows[0]).toMatchObject({ action: "create", state: "pending" });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("executa exatamente a proposta persistida quando o lead responde sim", async () => {
      const { sb, rpc } = makeStructuredSb({
        pending: {
          id: "pending-1",
          action: "create",
          event_id: null,
          proposed_date: "10/06/2026",
          proposed_time: "14:00",
          proposed_location: null,
          expires_at: "2026-06-01T16:00:00.000Z",
          state: "pending",
        },
      });
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Vou confirmar.",
        clientText: "sim",
        agendaAutomationEnabled: true,
        agendaPlan: {
          action: "none",
          date: null,
          time: null,
          location: null,
          eventId: null,
        },
        operationKey: "agent-response-job:turn-3:1:0",
      });

      expect(result.action).toBe("scheduled");
      expect(rpc).toHaveBeenCalledTimes(1);
    });
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

  describe("anti-alucinação e precedência da diretiva", () => {
    it("prosa do assistente citando outros dias NÃO sobrescreve a diretiva correta", async () => {
      const sb = makeSb(null);
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText:
          "Atendemos aos domingos e sábados também, mas agendei conforme combinado. [[AGENDAR: data=15/06/2026, hora=10:00]]",
        clientText: "sim",
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("scheduled");
      expect(insertAgendaEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ start_at: "2026-06-15T13:00:00.000Z" }),
      );
    });

    it("proposta 'Confirmando... Está tudo certo?' + sim executa de verdade (sem diretiva do modelo)", async () => {
      const sb = makeSb(null);
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Ótimo! Sua visita está agendada para 15/06/2026 às 10:00.",
        clientText: "sim",
        priorAssistantText:
          "Perfeito! Vou agendar sua visita. Confirmando: 15/06/2026 às 10:00. Está tudo certo?",
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("scheduled");
      expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    });

    it("modelo afirmando sucesso sem evento ativo e sem execução tem a resposta substituída", async () => {
      const sb = makeSb(null);
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Ótimo! Sua entrevista está agendada para sexta-feira, às 14h. Até lá!",
        clientText: "obrigado",
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("none");
      expect(result.text).toBe(AGENDA_UNVERIFIED_CLAIM_REPLY);
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
    });

    it("modelo citando agendamento existente real mantém a resposta", async () => {
      const sb = makeSb(EXISTING_EVENT);
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Seu horário está agendado para 10/06/2026 às 14:00, te espero!",
        clientText: "obrigado",
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("none");
      expect(result.text).toContain("está agendado");
    });

    it("recusa atômica de generation_stale da RPC → action stale, zero mutação, nada enviado", async () => {
      // sb com RPC que recusa por geração superada (mensagem mais nova chegou).
      const staleSb = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: table === "leads" ? { name: "Maria" } : null,
                error: null,
              }),
            }),
          }),
        }),
        rpc: async () => ({ data: null, error: { message: "generation_stale" } }),
      } as never;
      const result = await resolveAgendaTurn({
        sb: staleSb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Agendado! [[AGENDAR: data=10/06/2026, hora=14:00]]",
        clientText: "sim",
        agendaAutomationEnabled: true,
        operationKey: "agent-response-job:job-1:2:0",
        jobId: "job-1",
        claimedGeneration: 2,
      });
      // action "stale" faz o worker (evolution-agent-reply) abortar antes de
      // enviar/notificar; o texto não é usado. O que importa é a recusa atômica.
      expect(result.action).toBe("stale");
    });

    it("confirmação após complemento cross-job executa uma única mutação e confirma", async () => {
      // Job final: o lead confirma; a proposta do assistente carrega data/hora
      // que vieram de turnos anteriores. Executa exatamente uma vez.
      const result = await resolveAgendaTurn({
        sb: makeSb(null),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        leadId: "lead-1",
        timezone: "America/Sao_Paulo",
        modelText: "Pronto, agendei para 02/06/2026 às 14:00.",
        clientText: "sim",
        priorAssistantText: "Posso confirmar o agendamento para 02/06/2026 às 14:00?",
        recentClientMessages: ["Pode ser amanhã as", "duas da tarde", "sim"],
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("scheduled");
      expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    });

    it("regressão produção: amanhã + correção de hora + Confirmado agenda de verdade", async () => {
      const base = {
        sb: makeSb(null),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        leadId: "lead-1",
        timezone: "America/Sao_Paulo",
        agendaAutomationEnabled: true,
      } as const;

      const missingTime = await resolveAgendaTurn({
        ...base,
        // O modelo não pode inventar 14h quando o lead informou apenas o dia.
        modelText: "Perfeito! Você gostaria de agendar para amanhã às 14h?",
        clientText: "pra amanh˜",
        recentClientMessages: ["Oi gostaria de agendar uma visita", "pra amanh˜"],
      });

      expect(missingTime.action).toBe("failed");
      expect(missingTime.text).toContain("data e o horário certinhos");
      expect(insertAgendaEventMock).not.toHaveBeenCalled();

      const proposal = await resolveAgendaTurn({
        ...base,
        modelText: "Perfeito, sua visita ficou agendada para amanhã às 15h.",
        clientText: "as 3 da tarde",
        priorAssistantText: "Perfeito! Você gostaria de agendar para amanhã às 14h?",
        recentClientMessages: [
          "Oi gostaria de agendar uma visita",
          "pra amanh˜",
          "as 3 da tarde",
        ],
      });

      expect(proposal.action).toBe("needs_confirmation");
      expect(proposal.text).toContain("02/06/2026");
      expect(proposal.text).toContain("15h");
      expect(insertAgendaEventMock).not.toHaveBeenCalled();

      const confirmed = await resolveAgendaTurn({
        ...base,
        modelText: "Perfeito, sua visita ficou agendada.",
        clientText: "Confirmado",
        priorAssistantText: proposal.text,
        recentClientMessages: [
          "Oi gostaria de agendar uma visita",
          "pra amanh˜",
          "as 3 da tarde",
          "Confirmado",
        ],
      });

      expect(confirmed.action).toBe("scheduled");
      expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
      expect(insertAgendaEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ start_at: "2026-06-02T18:00:00.000Z" }),
      );
    });

    it("Confirmado recupera o último datetime inbound mesmo sem diretiva do modelo", async () => {
      const result = await resolveAgendaTurn({
        sb: makeSb(null),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Perfeito, ficou confirmado.",
        clientText: "Confirmado",
        recentClientMessages: [
          "Oi, gostaria de agendar um horário",
          "16/07 às 14:00",
          "Confirmado",
        ],
        agendaAutomationEnabled: true,
      });

      expect(result.action).toBe("scheduled");
      expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
      expect(insertAgendaEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ start_at: "2026-07-16T17:00:00.000Z" }),
      );
    });
  });

  describe("janela de disponibilidade e horários ocupados", () => {
    it("fora da janela com handoff OFF mantém a mensagem específica (não sobrescreve)", async () => {
      const disp = {
        ativo: true,
        diasSemana: [0, 1, 2, 3, 4, 5, 6],
        horaInicio: "08:00",
        horaFim: "12:00",
      };
      const result = await resolveAgendaTurn({
        sb: makeFlexSb({ existing: null }),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Agendado! [[AGENDAR: data=10/06/2026, hora=14:00]]",
        clientText: "sim",
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        agendaDisponibilidade: disp,
      });
      expect(result.action).toBe("failed");
      expect(result.text).toBe(buildOutsideAvailabilityReply(disp));
      expect(result.text).toContain("das 08:00 às 12:00");
      expect(result.text).not.toBe(AGENDA_FAILURE_REPLY_NO_HANDOFF);
      expect(result.deferHandoff).toBe(true);
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
    });

    it("fora da janela usa a mensagem personalizada quando configurada", async () => {
      const result = await resolveAgendaTurn({
        sb: makeFlexSb({ existing: null }),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Agendado! [[AGENDAR: data=10/06/2026, hora=14:00]]",
        clientText: "sim",
        agendaAutomationEnabled: true,
        agendaDisponibilidade: {
          ativo: true,
          diasSemana: [0, 1, 2, 3, 4, 5, 6],
          horaInicio: "08:00",
          horaFim: "12:00",
          mensagemForaJanela: "Atendemos somente pela manhã. Qual horário entre 08:00 e 12:00 fica bom?",
        },
      });
      expect(result.action).toBe("failed");
      expect(result.text).toBe("Atendemos somente pela manhã. Qual horário entre 08:00 e 12:00 fica bom?");
    });

    it("falha genérica com handoff OFF continua usando a resposta neutra padrão", async () => {
      insertAgendaEventMock.mockRejectedValueOnce(new Error("db_error"));
      const result = await resolveAgendaTurn({
        sb: makeFlexSb({ existing: null }),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Agendado! [[AGENDAR: data=10/06/2026, hora=14:00]]",
        clientText: "sim",
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
      });
      expect(result.action).toBe("failed");
      expect(result.text).toBe(AGENDA_FAILURE_REPLY_NO_HANDOFF);
    });

    it("horário ocupado com bloqueio de simultâneos responde a mensagem específica", async () => {
      const result = await resolveAgendaTurn({
        sb: makeFlexSb({ existing: null, conflictRow: { id: "evt-busy" } }),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Agendado! [[AGENDAR: data=10/06/2026, hora=14:00]]",
        clientText: "sim",
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
        agendaDisponibilidade: {
          ativo: false,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "08:00",
          horaFim: "18:00",
          permitirAgendamentosSimultaneos: false,
        },
      });
      expect(result.action).toBe("failed");
      expect(result.text).toBe(AGENDA_SLOT_TAKEN_REPLY);
      expect(result.deferHandoff).toBe(true);
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
    });

    it("regressão real: ordem em áudio vence plano ISO antigo e agenda amanhã às 14h", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Posso confirmar esse horário?",
        clientText: "Pode agendar um horário pra amanhã às duas horas.",
        recentClientMessages: ["Pode agendar um horário pra amanhã às duas horas."],
        agendaAutomationEnabled: true,
        agendaDisponibilidade: {
          ativo: true,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "09:00",
          horaFim: "15:05",
        },
        agendaPlan: {
          action: "propose_create",
          date: "2023-10-17",
          time: "14:00",
          location: null,
          eventId: null,
        },
        operationKey: "agent-response-job:incident:1:0",
      });

      expect(result).toMatchObject({
        action: "scheduled",
        text: "Pronto, ficou agendado para 02/06/2026, às 14h.",
      });
      expect(pendingRows).toHaveLength(0);
      expect(result.text).not.toContain("2023");
      expect(rpc).toHaveBeenCalledWith(
        "apply_agent_agenda_mutation",
        expect.objectContaining({ p_start_at: "2026-06-02T17:00:00.000Z" }),
      );
    });

    it("confirmação corrige proposta pendente antiga com o áudio real antes do commit", async () => {
      const { sb, rpc } = makeStructuredSb({
        pending: {
          id: "pending-incident",
          action: "create",
          event_id: null,
          proposed_date: "2023-10-17",
          proposed_time: "14:00",
          proposed_location: null,
          state: "pending",
          expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
      });
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Vou confirmar.",
        clientText: "Sim",
        recentClientMessages: [
          "Pode agendar um horário pra amanhã às duas horas.",
          "Sim",
        ],
        agendaAutomationEnabled: true,
        agendaDisponibilidade: {
          ativo: true,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "09:00",
          horaFim: "15:05",
        },
        agendaPlan: {
          action: "create",
          date: "2023-10-17",
          time: "14:00",
          location: null,
          eventId: null,
        },
        operationKey: "agent-response-job:incident-confirm:1:0",
      });

      expect(result).toMatchObject({
        action: "scheduled",
        text: "Pronto, ficou agendado para 02/06/2026, às 14h.",
      });
      expect(rpc).toHaveBeenCalledWith(
        "apply_agent_agenda_mutation",
        expect.objectContaining({ p_start_at: "2026-06-02T17:00:00.000Z" }),
      );
    });
  });

  describe("incidente de produção: fragmento + verdade da resposta", () => {
    const PROPOSTA_SEM_DATA = "Posso confirmar seu horário? Me diga o dia e a hora que ficam melhores.";

    it("fragmento 'Pode ser hoje as' não muta e pede data/hora exatas", async () => {
      const result = await resolveAgendaTurn({
        sb: makeSb(null),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Perfeito!",
        clientText: "Pode ser hoje as",
        priorAssistantText: PROPOSTA_SEM_DATA,
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("failed");
      expect(result.text).toBe(AGENDA_DATETIME_NEEDED_REPLY);
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
      expect(cancelAgendaEventMock).not.toHaveBeenCalled();
    });

    it("burst consolidado 'Pode ser hoje as' + 'duas da tarde' agenda hoje às 14:00", async () => {
      const result = await resolveAgendaTurn({
        sb: makeSb(null),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Perfeito!",
        clientText: "Pode ser hoje as\nduas da tarde",
        priorAssistantText: PROPOSTA_SEM_DATA,
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("scheduled");
      expect(insertAgendaEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ start_at: "2026-06-01T17:00:00.000Z" }),
      );
    });

    it("claim de sucesso com diretiva SEM confirmação vira pergunta de confirmação", async () => {
      const result = await resolveAgendaTurn({
        sb: makeSb(null),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Perfeito, sua sessão está agendada! [[AGENDAR: data=10/06/2026, hora=14:00]]",
        clientText: "quero marcar um horário",
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("needs_confirmation");
      expect(result.text).toBe("Posso confirmar para 10/06/2026, às 14h?");
      expect(result.text).not.toMatch(/est[aá]\s+agendad|agendei/i);
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
    });

    it("claim de sucesso com intenção de agenda sem diretiva vira pergunta de confirmação", async () => {
      const result = await resolveAgendaTurn({
        sb: makeSb(EXISTING_EVENT),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Pronto, está remarcado com sucesso!",
        clientText: "quero remarcar para outro dia",
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("needs_confirmation");
      expect(result.text).toBe("Posso confirmar essa alteração na agenda?");
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
      expect(cancelAgendaEventMock).not.toHaveBeenCalled();
    });

    it("fail-closed: banco indisponível nunca preserva afirmação de sucesso", async () => {
      const throwingSb = {
        from: () => {
          throw new Error("db_down");
        },
      } as unknown;
      const result = await resolveAgendaTurn({
        sb: throwingSb as never,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Prontinho! Sua reserva foi agendada.",
        clientText: "obrigado",
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("none");
      expect(result.text).toBe(AGENDA_UNVERIFIED_CLAIM_REPLY);
    });

    it("claim + confirmação + falha de persistência não responde sucesso", async () => {
      insertAgendaEventMock.mockRejectedValueOnce(new Error("db_error"));
      const result = await resolveAgendaTurn({
        sb: makeSb(null),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Agendado com sucesso! [[AGENDAR: data=10/06/2026, hora=14:00]]",
        clientText: "sim",
        agendaAutomationEnabled: true,
      });
      expect(result.action).toBe("failed");
      expect(result.text).not.toMatch(/agendado com sucesso|est[aá]\s+agendad|agendei/i);
    });

    it("automação OFF continua permitindo leitura sem claim", async () => {
      const result = await resolveAgendaTurn({
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Seu próximo horário é 10/06 às 14:00, te aguardamos!",
        clientText: "que dia é meu horário?",
        agendaAutomationEnabled: false,
      });
      expect(result.action).toBe("none");
      expect(result.text).toBe("Seu próximo horário é 10/06 às 14:00, te aguardamos!");
    });

    it("automação OFF bloqueia pedido de remarcação sem nenhuma mutação", async () => {
      const result = await resolveAgendaTurn({
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Claro, vou remarcar para você!",
        clientText: "quero remarcar meu horário",
        agendaAutomationEnabled: false,
      });
      expect(result.action).toBe("blocked");
      expect(result.text).toBe(AGENDA_AUTOMATION_DISABLED_REPLY);
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
      expect(cancelAgendaEventMock).not.toHaveBeenCalled();
    });
  });

  describe("multi-nicho: mesma mecânica técnica, nomenclatura do tenant preservada", () => {
    const casos = [
      {
        tenant: "tenant-clinica",
        proposta: "Posso confirmar sua consulta para 10/06/2026 às 10:00?",
        modelo: "Consulta confirmada para 10/06! [[AGENDAR: data=10/06/2026, hora=10:00]]",
        palavra: "Consulta",
      },
      {
        tenant: "tenant-imob",
        proposta: "Posso confirmar a visita ao imóvel para 12/06/2026 às 14:00?",
        modelo: "Visita ao imóvel agendada! [[AGENDAR: data=12/06/2026, hora=14:00]]",
        palavra: "Visita",
      },
      {
        tenant: "tenant-barber",
        proposta: "Posso confirmar seu corte para 11/06/2026 às 16:00?",
        modelo: "Corte marcado, te espero! [[AGENDAR: data=11/06/2026, hora=16:00]]",
        palavra: "Corte",
      },
      {
        tenant: "tenant-rh",
        proposta: "Posso confirmar sua entrevista para 15/06/2026 às 14:00?",
        modelo: "Entrevista agendada! [[AGENDAR: data=15/06/2026, hora=14:00]]",
        palavra: "Entrevista",
      },
      {
        tenant: "tenant-custom",
        proposta: "Posso confirmar sua Sessão de Alinhamento para 16/06/2026 às 09:00?",
        modelo: "Sessão de Alinhamento confirmada! [[AGENDAR: data=16/06/2026, hora=09:00]]",
        palavra: "Sessão de Alinhamento",
      },
    ];

    for (const caso of casos) {
      it(`agenda com nomenclatura própria do tenant (${caso.tenant})`, async () => {
        insertAgendaEventMock.mockClear();
        const result = await resolveAgendaTurn({
          sb: makeSb(null),
          tenantId: caso.tenant,
          remoteJid: "5511999999999@s.whatsapp.net",
          timezone: "America/Sao_Paulo",
          modelText: caso.modelo,
          clientText: "sim",
          priorAssistantText: caso.proposta,
          agendaAutomationEnabled: true,
          ctaHandoffAtivo: true,
        });
        expect(result.action).toBe("scheduled");
        // Estrutura técnica idêntica e isolada por tenant…
        expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
        expect(insertAgendaEventMock).toHaveBeenCalledWith(
          expect.objectContaining({
            tenant_id: caso.tenant,
            attendee_phone: "5511999999999",
            created_by: "agent",
          }),
        );
        // …e a linguagem enviada ao lead vem do modelo/prompt do tenant.
        expect(result.text).toContain(caso.palavra);
      });
    }
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
