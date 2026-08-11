import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENDA_AUTOMATION_DISABLED_REPLY,
  AGENDA_DATETIME_NEEDED_REPLY,
  AGENDA_FAILURE_REPLY_NO_HANDOFF,
  AGENDA_INVALID_TIME_REPLY,
  AGENDA_PAST_DATETIME_REPLY,
  AGENDA_SLOT_TAKEN_REPLY,
  AGENDA_SUCCESS_REPLY_CANCELLED,
  AGENDA_SUCCESS_REPLY_RESCHEDULED,
  AGENDA_SUCCESS_REPLY_SCHEDULED,
  AGENDA_UNVERIFIED_CLAIM_REPLY,
  buildOutsideAvailabilityReply,
  clientConfirmedAgendaMutation,
  isInitialAgendaMutationRequest,
  clientRequestedAgendaList,
  isStandaloneAgendaConfirmation,
  listPlanLooksLikeScheduleAnswer,
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
    rpc: vi.fn(async (name: string) => ({
      data: name === "list_contact_agenda" && existing ? [existing] : [],
      error: null,
    })),
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
  events?: Array<Record<string, unknown>>;
  rpcAction?: "scheduled" | "rescheduled" | "cancelled";
} = {}) {
  const pendingRows: Record<string, unknown>[] = options.pending ? [{ ...options.pending }] : [];
  const rpc = vi.fn().mockImplementation(async (name: string) => {
    if (name !== "apply_agent_agenda_mutation" && name !== "apply_agent_agenda_mutation_guarded") {
      return { data: null, error: null };
    }
    return {
      data: {
        action: options.rpcAction ?? "scheduled",
        event: {
          ...EXISTING_EVENT,
          id: options.events?.[0]?.id ?? "evt-structured",
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
      if (table === "agenda_events") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.neq = () => chain;
        chain.gte = () => chain;
        chain.not = () => chain;
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.then = (resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) =>
          resolve({ data: options.events ?? [], error: null });
        chain.maybeSingle = async () => ({ data: (options.events ?? [])[0] ?? null, error: null });
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
    expect(isStandaloneAgendaConfirmation("Fica sim")).toBe(true);
    expect(isStandaloneAgendaConfirmation("fica bom")).toBe(true);
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

  it("não reutiliza proposta antiga depois de uma resposta posterior", () => {
    const prior = priorAgendaAssistantTextFromMessages([
      { role: "assistant", content: "Posso confirmar para 10/06/2026 às 14:00?" },
      { role: "user", content: "sim" },
      { role: "assistant", content: "Pronto, ficou agendado." },
      { role: "user", content: "obrigado" },
      { role: "assistant", content: "De nada! Até mais." },
      { role: "user", content: "Ok" },
    ]);
    expect(prior).toBeNull();
  });

  it("preserva convite de agenda sem data e hora como contexto, sem autorizar mutação", () => {
    const text =
      "Você tem um tempinho para agendar uma entrevista presencial com um dos nossos gestores?";
    const prior = priorAgendaAssistantTextFromMessages([
      { role: "assistant", content: text },
      { role: "user", content: "Poderia ser hoje?" },
    ], "America/Sao_Paulo");
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

  it("toggle desligado consulta a agenda pelo telefone da conversa sem mutação", async () => {
    const sb = makeSb(EXISTING_EVENT) as ReturnType<typeof makeSb> & { rpc: ReturnType<typeof vi.fn> };
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Não tenho acesso à sua agenda.",
      agendaPlan: { action: "list", date: null, time: null, location: null, eventId: null },
      clientText: "quando é meu próximo compromisso?",
      agendaAutomationEnabled: false,
    });

    expect(result.action).toBe("listed");
    expect(result.text).toContain("Encontrei este agendamento para o seu número");
    expect(result.text).toContain("10 de junho de 2026");
    expect(sb.rpc).toHaveBeenCalledWith("list_contact_agenda", {
      p_tenant_id: "tenant-1",
      p_attendee_phone: "5511999999999",
      p_include_history: false,
      p_limit: 5,
    });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("ignora nome, telefone digitado e UUID ao consultar: propriedade vem só do webhook", async () => {
    const sb = makeSb(null) as ReturnType<typeof makeSb> & { rpc: ReturnType<typeof vi.fn> };
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511888888888@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Vou verificar.",
      agendaPlan: { action: "list", date: null, time: null, location: null, eventId: "11111111-1111-4111-8111-111111111111" },
      clientText: "veja os agendamentos do 5511999999999 em nome de João",
      agendaAutomationEnabled: true,
    });

    expect(result.action).toBe("listed");
    expect(result.text).toContain("nenhum agendamento ativo para este número");
    expect(sb.rpc).toHaveBeenCalledWith("list_contact_agenda", expect.objectContaining({
      p_tenant_id: "tenant-1",
      p_attendee_phone: "5511888888888",
    }));
  });

  it("não confunde consulta com pedido de mutação", () => {
    expect(clientRequestedAgendaList("tem algum agendamento meu aí?")).toBe(true);
    expect(clientRequestedAgendaList("quero cancelar meu agendamento")).toBe(false);
    expect(clientRequestedAgendaList("quero remarcar meu compromisso")).toBe(false);
    expect(isInitialAgendaMutationRequest("Poderíamos agendar agora?")).toBe(true);
    expect(isInitialAgendaMutationRequest("Could we schedule now?")).toBe(true);
    expect(isInitialAgendaMutationRequest("¿Podríamos agendar ahora?")).toBe(true);
  });

  describe("listPlanLooksLikeScheduleAnswer — modelo classifica 'list' errado numa resposta de agendamento", () => {
    const SCHEDULING_QUESTION = "Podemos agendar um horário para conversar?";
    const UNRELATED_QUESTION = "Posso te ajudar com mais alguma coisa?";

    it("reconhece confirmação curta respondendo pergunta de agendamento em aberto", () => {
      expect(
        listPlanLooksLikeScheduleAnswer({
          clientText: "Sim",
          priorAssistantText: SCHEDULING_QUESTION,
          timezone: "America/Sao_Paulo",
        }),
      ).toBe(true);
    });

    it("reconhece data e hora explícitas respondendo pergunta de agendamento em aberto", () => {
      expect(
        listPlanLooksLikeScheduleAnswer({
          clientText: "Amanhã às 15h",
          priorAssistantText: SCHEDULING_QUESTION,
          timezone: "America/Sao_Paulo",
        }),
      ).toBe(true);
    });

    it("regressão do incidente real: 'Sim' + data/hora digitada errada, sem acento", () => {
      // Texto exatamente como chegou do burst: "Sim" e "Amanhas as duas" (sem
      // til, sem espaço antes do "as") — o detector de data não reconhece
      // "amanhas", mas a confirmação "Sim" e o horário "duas" já bastam.
      expect(
        listPlanLooksLikeScheduleAnswer({
          clientText: "Sim\nAmanhas as duas",
          priorAssistantText: SCHEDULING_QUESTION,
          timezone: "America/Sao_Paulo",
        }),
      ).toBe(true);
    });

    it("não dispara sem pergunta de agendamento em aberto antes", () => {
      expect(
        listPlanLooksLikeScheduleAnswer({
          clientText: "Sim",
          priorAssistantText: UNRELATED_QUESTION,
          timezone: "America/Sao_Paulo",
        }),
      ).toBe(false);
    });

    it("não dispara sem nenhum sinal de confirmação ou data/hora no texto do cliente", () => {
      expect(
        listPlanLooksLikeScheduleAnswer({
          clientText: "Qual é o valor?",
          priorAssistantText: SCHEDULING_QUESTION,
          timezone: "America/Sao_Paulo",
        }),
      ).toBe(false);
    });

    it("não dispara sem contexto anterior nenhum", () => {
      expect(
        listPlanLooksLikeScheduleAnswer({
          clientText: "Sim",
          priorAssistantText: null,
          timezone: "America/Sao_Paulo",
        }),
      ).toBe(false);
    });
  });

  describe("plano 'list' mal classificado dentro de resolveAgendaTurn", () => {
    it("reclassifica 'list' como agendamento quando o cliente responde a uma pergunta de agendamento em aberto", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Vou verificar a disponibilidade.",
        clientText: "Sim, amanhã às 15h",
        priorAssistantText: "Podemos agendar um horário para conversar?",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "list", date: null, time: null, location: null, eventId: null },
        operationKey: "agent-response-job:turn-list-1:1:0",
      });

      // Nunca mais "não encontrei nenhum agendamento" para quem está tentando marcar um.
      expect(result.action).not.toBe("listed");
      expect(result.text).not.toContain("Não encontrei nenhum agendamento");
      expect(result.action).toBe("needs_confirmation");
      expect(result.text).toContain("02/06/2026");
      expect(pendingRows[0]).toMatchObject({ action: "create", proposed_date: "02/06/2026" });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("regressão 11/08: convite inicial + disponibilidade hoje nunca vira consulta", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText:
          "As entrevistas acontecem de segunda a sexta, das 9h às 18h. Vou verificar o próximo horário disponível para você.",
        clientText: "Excelente!\nEstou disponível hoje em tempo integral\nPoderia ser hoje?",
        priorAssistantText:
          "Você tem um tempinho para agendar uma entrevista presencial com um dos nossos gestores?",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "list", date: null, time: null, location: null, eventId: null },
        operationKey: "agent-response-job:incident-11-08:first:0",
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 3,
        conversationSequence: 3,
      });

      expect(result.action).toBe("none");
      expect(result.text).toBe(AGENDA_DATETIME_NEEDED_REPLY);
      expect(result.text).not.toContain("agendamento ativo para este número");
      expect(pendingRows).toHaveLength(0);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("regressão 11/08: 'Poderíamos agendar agora?' pede slot concreto, nunca consulta", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText:
          "As entrevistas acontecem de segunda a sexta, das 9h às 18h. Vou verificar o próximo horário disponível para você.",
        clientText: "Poderíamos agendar agora?",
        priorAssistantText: "Não encontrei nenhum agendamento ativo para este número.",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "list", date: null, time: null, location: null, eventId: null },
        operationKey: "agent-response-job:incident-11-08:second:0",
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 1,
        conversationSequence: 4,
      });

      expect(result.action).toBe("none");
      expect(result.text).toBe(AGENDA_DATETIME_NEEDED_REPLY);
      expect(result.text).not.toContain("agendamento ativo para este número");
      expect(pendingRows).toHaveLength(0);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("bloqueia list do modelo sem pedido explícito e preserva conversa comum", async () => {
      const sb = makeSb(null) as ReturnType<typeof makeSb> & { rpc: ReturnType<typeof vi.fn> };
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Claro! Posso explicar melhor como funciona.",
        clientText: "Pode explicar melhor?",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "list", date: null, time: null, location: null, eventId: null },
        jobId: "33333333-3333-4333-8333-333333333333",
      });

      expect(result).toMatchObject({
        action: "none",
        text: "Claro! Posso explicar melhor como funciona.",
      });
      expect(sb.rpc).not.toHaveBeenCalled();
    });

    it("preserva uma consulta genuína mesmo com plano 'list' e contexto de agendamento em aberto", async () => {
      const sb = makeSb(EXISTING_EVENT) as ReturnType<typeof makeSb> & { rpc: ReturnType<typeof vi.fn> };
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Vou verificar.",
        clientText: "Quero ver meus agendamentos",
        priorAssistantText: "Podemos agendar um horário para conversar?",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "list", date: null, time: null, location: null, eventId: null },
      });

      expect(result.action).toBe("listed");
      expect(result.text).toContain("Encontrei este agendamento para o seu número");
    });

    it("não executa 'list' do modelo sem pedido explícito do lead", async () => {
      const sb = makeSb(null) as ReturnType<typeof makeSb> & { rpc: ReturnType<typeof vi.fn> };
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Vou verificar.",
        clientText: "Sim",
        priorAssistantText: "Posso te ajudar com mais alguma coisa?",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "list", date: null, time: null, location: null, eventId: null },
      });

      expect(result.action).toBe("none");
      expect(result.text).toBe("Vou verificar.");
      expect(sb.rpc).not.toHaveBeenCalled();
    });
  });

  describe("plano estruturado da agenda", () => {
    it("transforma uma ordem direta e completa em proposta antes de criar", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
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
        action: "needs_confirmation",
        text: "Posso confirmar para 10/06/2026, às 14h?",
      });
      expect(pendingRows[0]).toMatchObject({
        action: "create",
        proposed_date: "10/06/2026",
        proposed_time: "14:00",
        state: "pending",
      });
      expect(rpc).not.toHaveBeenCalled();
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
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 1,
        conversationSequence: 2,
      });

      expect(result.action).toBe("scheduled");
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith(
        "apply_agent_agenda_mutation_guarded",
        expect.objectContaining({
          p_tenant_id: "tenant-1",
          p_attendee_phone: "5511999999999",
          p_job_id: "33333333-3333-4333-8333-333333333333",
          p_claimed_generation: 1,
          p_conversation_sequence: 2,
        }),
      );
    });

    it("pedido direto de cancelamento cria proposta ligada ao evento sem mutar", async () => {
      const event = {
        ...EXISTING_EVENT,
        id: "11111111-1111-4111-8111-111111111111",
      };
      const { sb, rpc, pendingRows } = makeStructuredSb({ events: [event] });
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        journeyId: "22222222-2222-4222-8222-222222222222",
        timezone: "America/Sao_Paulo",
        modelText: "Vou cancelar.",
        clientText: "Gostaria de cancelar o agendamento",
        agendaAutomationEnabled: true,
        agendaPlan: {
          action: "none",
          date: null,
          time: null,
          location: null,
          eventId: null,
        },
        operationKey: "agent-response-job:cancel-proposal:1:0",
      });

      expect(result.action).toBe("needs_confirmation");
      expect(result.text).toContain("Você quer cancelar seu agendamento de");
      expect(result.text).toContain("10 de junho de 2026");
      expect(pendingRows[0]).toMatchObject({
        action: "cancel",
        event_id: event.id,
        proposed_date: "10/06/2026",
        proposed_time: "14:00",
        state: "pending",
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("confirmação executa exatamente um cancelamento pendente", async () => {
      const event = {
        ...EXISTING_EVENT,
        id: "11111111-1111-4111-8111-111111111111",
      };
      getAgendaEventByIdMock.mockResolvedValue(event);
      const { sb, rpc, pendingRows } = makeStructuredSb({
        rpcAction: "cancelled",
        events: [event],
        pending: {
          id: "pending-cancel",
          journey_id: "22222222-2222-4222-8222-222222222222",
          action: "cancel",
          event_id: event.id,
          proposed_date: "10/06/2026",
          proposed_time: "14:00",
          proposed_location: null,
          timezone: "America/Sao_Paulo",
          expires_at: "2026-06-01T16:00:00.000Z",
          state: "pending",
        },
      });
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        journeyId: "22222222-2222-4222-8222-222222222222",
        timezone: "America/Sao_Paulo",
        modelText: "Vou confirmar.",
        clientText: "sim",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "none", date: null, time: null, location: null, eventId: null },
        operationKey: "agent-response-job:cancel-confirm:1:0",
      });

      expect(result.action).toBe("cancelled");
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith(
        "apply_agent_agenda_mutation",
        expect.objectContaining({ p_action: "cancel", p_event_id: event.id }),
      );
      expect(pendingRows[0]).toMatchObject({ state: "executed" });
    });

    it("recusa cancela a proposta sem cancelar o evento", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb({
        pending: {
          id: "pending-cancel",
          journey_id: null,
          action: "cancel",
          event_id: "11111111-1111-4111-8111-111111111111",
          proposed_date: "10/06/2026",
          proposed_time: "14:00",
          proposed_location: null,
          timezone: "America/Sao_Paulo",
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
        modelText: "Tudo bem.",
        clientText: "não, pode manter",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "none", date: null, time: null, location: null, eventId: null },
      });
      expect(result.action).toBe("none");
      expect(result.text).toContain("mantive seu agendamento");
      expect(pendingRows[0]).toMatchObject({ state: "rejected" });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("múltiplos eventos exigem escolha antes de criar proposta", async () => {
      const events = [
        { ...EXISTING_EVENT, id: "11111111-1111-4111-8111-111111111111" },
        {
          ...EXISTING_EVENT,
          id: "33333333-3333-4333-8333-333333333333",
          start_at: "2026-06-11T18:00:00.000Z",
          end_at: "2026-06-11T19:00:00.000Z",
        },
      ];
      const { sb, rpc, pendingRows } = makeStructuredSb({ events });
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Qual deles?",
        clientText: "Quero cancelar um agendamento",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "cancel", date: null, time: null, location: null, eventId: null },
      });
      expect(result.action).toBe("needs_confirmation");
      expect(result.text).toContain("1)");
      expect(result.text).toContain("2)");
      expect(pendingRows).toHaveLength(0);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("escolha numerada de múltiplos eventos cria a proposta exata sem cancelar", async () => {
      const events = [
        { ...EXISTING_EVENT, id: "11111111-1111-4111-8111-111111111111" },
        {
          ...EXISTING_EVENT,
          id: "33333333-3333-4333-8333-333333333333",
          start_at: "2026-06-11T18:00:00.000Z",
          end_at: "2026-06-11T19:00:00.000Z",
        },
      ];
      const { sb, rpc, pendingRows } = makeStructuredSb({ events });
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        priorAssistantText:
          "Encontrei mais de um agendamento ativo: 1) 10 de junho; 2) 11 de junho. Qual deles você quer cancelar?",
        modelText: "Certo.",
        clientText: "2",
        agendaAutomationEnabled: true,
        agendaPlan: { action: "none", date: null, time: null, location: null, eventId: null },
      });

      expect(result.action).toBe("needs_confirmation");
      expect(result.text).toContain("11 de junho de 2026");
      expect(pendingRows[0]).toMatchObject({
        action: "cancel",
        event_id: events[1]!.id,
        proposed_date: "11/06/2026",
        proposed_time: "15:00",
        state: "pending",
      });
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  it("horário impossível é rejeitado sem normalização silenciosa", async () => {
    const result = await resolveAgendaTurn({
      sb: makeSb(null),
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Posso confirmar para 13:76?",
      clientText: "13:76",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: "10/06/2026", time: null, location: null, eventId: null },
    });
    expect(result).toMatchObject({ action: "failed", text: AGENDA_INVALID_TIME_REPLY });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("Ok e Até mais sem proposta pendente não reativam a agenda", async () => {
    const result = await resolveAgendaTurn({
      sb: makeSb(EXISTING_EVENT),
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      modelText: "Até mais!",
      clientText: "Ok\nAté mais",
      recentClientMessages: ["Agende 10/06/2026 às 14:00", "sim", "obrigado", "Ok", "Até mais"],
      agendaAutomationEnabled: true,
      agendaPlan: { action: "none", date: null, time: null, location: null, eventId: null },
    });
    expect(result.action).toBe("none");
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("oide ou pode sem proposta pendente não recriam operação antiga do histórico", async () => {
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Posso confirmar para 10/06/2026, às 14h?",
      clientText: "oide",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: "10/06/2026", time: "14:00", location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 8,
    });
    // "oide" é cumprimento curto sem soft-invite; se o modelo trouxer slot concreto
    // gravamos pending (em vez de amnésia "Como posso ajudar?").
    expect(result.action).toBe("needs_confirmation");
    expect(result.text).toMatch(/10\/06\/2026|14h/i);
    expect(pendingRows.length).toBeGreaterThan(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Sim curto sem pending devolve a pergunta NATURAL do modelo (sem executar)", async () => {
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      // Resposta conversacional do modelo: conduz o fluxo pedindo dia/horário,
      // sem afirmar sucesso e sem re-propor confirmação concreta órfã.
      modelText: "Ótimo! Qual dia e horário ficam melhores para você?",
      clientText: "Sim",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: null, time: null, location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 9,
    });
    expect(result.action).toBe("none");
    expect(result.text).toBe("Ótimo! Qual dia e horário ficam melhores para você?");
    expect(pendingRows).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Sim curto sem pending com claim do modelo cai no texto seguro", async () => {
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Perfeito, sua conversa está agendada!",
      clientText: "Sim",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: null, time: null, location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 9,
    });
    expect(result.action).toBe("none");
    expect(result.text).toBe("Certo. Como posso ajudar?");
    expect(pendingRows).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Pode ser após soft-invite Meta preserva pergunta natural do modelo (sem amnésia)", async () => {
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Ótimo! Qual dia e horário ficam melhores para a conversa com o gestor?",
      clientText: "Pode ser",
      priorAssistantText:
        "Oi, Renato! Tudo bem? Acabei de receber seu cadastro e gostaria de agendar uma conversa rápida com um dos nossos gestores. Que tal?",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: null, time: null, location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 2,
    });
    expect(result.action).toBe("none");
    expect(result.text).toBe(
      "Ótimo! Qual dia e horário ficam melhores para a conversa com o gestor?",
    );
    expect(result.text).not.toMatch(/Como posso ajudar/i);
    expect(pendingRows).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Pode ser após soft-invite sem texto útil do modelo continua pedindo dia/hora (não amnésia)", async () => {
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "",
      clientText: "Pode ser",
      priorAssistantText:
        "Acabei de receber seu cadastro e gostaria de agendar uma conversa rápida. Que tal?",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: null, time: null, location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 2,
    });
    expect(result.action).toBe("none");
    expect(result.text).toMatch(/dia e horário/i);
    expect(result.text).not.toMatch(/Como posso ajudar/i);
    expect(pendingRows).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("soft-invite + Pode ser + modelo com slot concreto grava pending (não early-return)", async () => {
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Ótimo! Podemos te receber amanhã às 14h. Fica bom?",
      clientText: "Pode ser",
      priorAssistantText:
        "Oi! Acabei de receber seu cadastro e gostaria de agendar uma conversa rápida. Que tal?",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: "01/06/2026", time: "14:00", location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 2,
    });
    expect(result.action).toBe("needs_confirmation");
    expect(result.text).toMatch(/amanhã às 14h/i);
    expect(result.text).not.toBe(AGENDA_PAST_DATETIME_REPLY);
    expect(pendingRows.some((row) => row.state === "pending" || row.proposed_date)).toBe(true);
    const pending = pendingRows.find((row) => row.proposed_date || row.state === "pending") ?? pendingRows.at(-1);
    expect(pending?.proposed_date).toBe("02/06/2026");
    expect(pending?.proposed_time).toBe("14:00");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Fica sim com pending futuro confirma amanhã — nunca PAST por plano alucinado de hoje", async () => {
    vi.setSystemTime(new Date("2026-06-01T16:51:00-03:00"));
    const { sb, rpc, pendingRows } = makeStructuredSb({
      pending: {
        id: "pending-1",
        action: "create",
        event_id: null,
        proposed_date: "02/06/2026",
        proposed_time: "14:00",
        proposed_location: null,
        state: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    });
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Confirmado para hoje às 14h.",
      clientText: "Fica sim",
      priorAssistantText: "Ótimo! Podemos te receber amanhã às 14h. Fica bom?",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "none", date: null, time: null, location: null, eventId: null },
      operationKey: "agent-response-job:turn-fica-sim:1:0",
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 3,
    });
    expect(result.text).not.toBe(AGENDA_PAST_DATETIME_REPLY);
    expect(result.action).toBe("scheduled");
    expect(rpc).toHaveBeenCalled();
    expect(pendingRows[0]?.state).not.toBe("pending");
  });

  it("âncora parcial 'próxima segunda' sem hora não herda plano passado (não PAST)", async () => {
    vi.setSystemTime(new Date("2026-06-01T16:51:00-03:00"));
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Perfeito, posso confirmar?",
      clientText: "Pode ser na próxima segunda",
      priorAssistantText: "Ótimo! Podemos te receber amanhã às 14h. Fica bom?",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: "01/06/2026", time: "14:00", location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 4,
    });
    expect(result.text).not.toBe(AGENDA_PAST_DATETIME_REPLY);
    expect(result.action).not.toBe("scheduled");
    expect(pendingRows.filter((row) => row.state === "pending" || row.proposed_date === "01/06/2026")).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lead dá só a data ('terçå' com til torto, sem hora reconhecível) — usa a hora da PROSA VISÍVEL do modelo, nunca do JSON alucinado (incidente real Helena)", async () => {
    // Sexta 05/06/2026 -> próxima terça = 09/06/2026. Reproduz o burst real: o
    // lead nunca escreveu uma hora reconhecível ("umas duas" não conta sem
    // às/horas/período), só a data ("terçå"). O plano oculto do modelo veio
    // alucinado com uma data de 2023 (nunca deve ser usado); a hora certa só
    // existe na frase que o próprio modelo mostrou ao lead.
    vi.setSystemTime(new Date("2026-06-05T16:51:00-03:00"));
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Entendi! 😊 Que tal agendarmos para terça-feira às 14h? Fica bom para você?",
      clientText: "pode ser sei lá, umas duas, terçå ou quarta, qual dia ta melhor pra vc?",
      agendaAutomationEnabled: true,
      agendaPlan: {
        action: "propose_create",
        date: "10/10/2023",
        time: "14:00",
        location: null,
        eventId: null,
      },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 6,
    });
    expect(result.action).toBe("needs_confirmation");
    expect(result.text).not.toBe(AGENDA_DATETIME_NEEDED_REPLY);
    expect(pendingRows.at(-1)).toMatchObject({
      proposed_date: "09/06/2026",
      proposed_time: "14:00",
      state: "pending",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cliente com sinal de 'agora' não completa a hora pela prosa do modelo (não reabre incidente 'segunda agora')", async () => {
    // Mesma família do incidente "Pode ser segunda agora": "agora" torna o
    // pedido ambíguo demais para confiar na hora que o modelo propôs — cai no
    // caminho antigo (pede data/hora de novo), nunca inventa um slot.
    vi.setSystemTime(new Date("2026-06-05T16:51:00-03:00"));
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Conseguimos te receber na terça-feira às 14h. Fica bom para você?",
      clientText: "pode ser terça agora",
      agendaAutomationEnabled: true,
      agendaPlan: {
        action: "propose_create",
        date: "10/10/2023",
        time: "14:00",
        location: null,
        eventId: null,
      },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 7,
    });
    expect(result.action).toBe("none");
    expect(result.text).toBe(AGENDA_DATETIME_NEEDED_REPLY);
    expect(pendingRows).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("próxima segunda + 5 da tarde coalescidos resolve slot futuro (não PAST)", async () => {
    vi.setSystemTime(new Date("2026-06-01T16:51:00-03:00"));
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Posso confirmar segunda às 17h?",
      clientText: "Pode ser na próxima segunda\n5 da tarde",
      recentClientMessages: ["Pode ser na próxima segunda", "5 da tarde"],
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: "01/06/2026", time: "14:00", location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 5,
      agendaDisponibilidade: {
        ativo: true,
        diasSemana: [1, 2, 3, 4, 5],
        horaInicio: "09:00",
        horaFim: "18:00",
      },
    });
    expect(result.text).not.toBe(AGENDA_PAST_DATETIME_REPLY);
    expect(result.action).toBe("needs_confirmation");
    const pending = pendingRows.at(-1);
    expect(pending?.proposed_date).toBe("08/06/2026");
    expect(pending?.proposed_time).toBe("17:00");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("proposta em dia fora da janela responde fora da agenda — não 'já passou'", async () => {
    // 01/06/2026 é segunda; amanhã = terça. Forçamos sábado via plano/prosa.
    vi.setSystemTime(new Date("2026-06-05T16:51:00-03:00")); // sexta
    const { sb, rpc, pendingRows } = makeStructuredSb();
    const result = await resolveAgendaTurn({
      sb,
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      modelText: "Ótimo! Podemos te receber amanhã às 14h. Fica bom?",
      clientText: "Pode ser",
      priorAssistantText: "Gostaria de agendar uma conversa rápida. Que tal?",
      agendaAutomationEnabled: true,
      agendaPlan: { action: "create", date: "06/06/2026", time: "14:00", location: null, eventId: null },
      jobId: "33333333-3333-4333-8333-333333333333",
      claimedGeneration: 1,
      conversationSequence: 2,
      agendaDisponibilidade: {
        ativo: true,
        diasSemana: [1, 2, 3, 4, 5],
        horaInicio: "09:00",
        horaFim: "18:00",
      },
    });
    expect(result.text).not.toBe(AGENDA_PAST_DATETIME_REPLY);
    expect(result.action).toBe("failed");
    expect(result.text).toMatch(/disponib|janela|segunda|sexta|horário/i);
    expect(pendingRows).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
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
      expect(result.text).toBe("Pronto, remarcado para 15/06/2026 às 10h.");
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
      const { sb: staleSb, rpc } = makeStructuredSb({
        pending: {
          id: "pending-stale",
          action: "create",
          event_id: null,
          proposed_date: "10/06/2026",
          proposed_time: "14:00",
          proposed_location: null,
          expires_at: "2026-06-01T16:00:00.000Z",
          state: "pending",
        },
      });
      rpc.mockResolvedValueOnce({ data: null, error: { message: "generation_stale" } });
      const result = await resolveAgendaTurn({
        sb: staleSb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        agentId: "agent-1",
        modelText: "Vou confirmar.",
        agendaPlan: { action: "none", date: null, time: null, location: null, eventId: null },
        clientText: "sim",
        agendaAutomationEnabled: true,
        operationKey: "agent-response-job:job-1:2:0",
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 2,
        conversationSequence: 7,
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

      // Quando o modelo pergunta pelo horário SEM inventar um, a resposta
      // conversacional dele segue no lugar do texto fixo — sem mutação.
      const naturalAsk = await resolveAgendaTurn({
        ...base,
        modelText: "Perfeito! Que horário fica melhor para você amanhã?",
        clientText: "pra amanh˜",
        recentClientMessages: ["Oi gostaria de agendar uma visita", "pra amanh˜"],
      });
      expect(naturalAsk.action).toBe("none");
      expect(naturalAsk.text).toBe("Perfeito! Que horário fica melhor para você amanhã?");
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

    it("Confirmado sem proposta pendente não reutiliza datetime antigo", async () => {
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

      expect(result.action).toBe("none");
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
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

    it("regressão real: ordem em áudio corrige plano ISO antigo antes da confirmação", async () => {
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
        action: "needs_confirmation",
        text: "Posso confirmar para 02/06/2026, às 14h?",
      });
      expect(pendingRows[0]).toMatchObject({
        action: "create",
        proposed_date: "02/06/2026",
        proposed_time: "14:00",
        state: "pending",
      });
      expect(result.text).not.toContain("2023");
      expect(rpc).not.toHaveBeenCalled();
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

    it("incidente real 19/07: 'Uai pode ser' + plano 2023 → propõe o slot do TEXTO visível do modelo e salva pending", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Conseguimos te receber amanhã às 14h. Fica bom para você?",
        clientText: "Uai pode ser",
        agendaAutomationEnabled: true,
        agendaDisponibilidade: {
          ativo: true,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "09:00",
          horaFim: "18:00",
        },
        agendaPlan: {
          action: "propose_create",
          date: "05/10/2023",
          time: "14:00",
          location: null,
          eventId: null,
        },
      });
      expect(result.action).toBe("needs_confirmation");
      expect(result.text).not.toBe(AGENDA_PAST_DATETIME_REPLY);
      expect(pendingRows[0]).toMatchObject({
        action: "create",
        proposed_date: "02/06/2026",
        proposed_time: "14:00",
        state: "pending",
      });
      expect(rpc).not.toHaveBeenCalled();
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
    });

    it("incidente real 27/07: 'ok'/'obrigado' pos-agendamento nao reabre confirmacao do mesmo horario ja ativo", async () => {
      // Lead confirmou e o agendamento ja existe (evento ativo real). No turno
      // seguinte ele manda dois fragmentos de burst ("ok" + "obrigado",
      // concatenados pelo smart-wait) - sem nenhum sinal de agenda - mas o
      // modelo volta a alegar sucesso com o MESMO horario. Antes desta
      // correcao, o agente reabria o ciclo de confirmacao ("Posso confirmar
      // para 28/07/2026, as 14h?") para algo que o lead ja tinha confirmado,
      // deixando-o achando que o agente esta com bug. Texto de duas linhas de
      // proposito: um "obrigado" isolado ja cai no atalho de resposta curta
      // existente (CONTEXT_FREE_SHORT_REPLY_RE) - o burst real de producao
      // NAO bate nesse atalho, e e exatamente o caminho que esta guarda cobre.
      const { sb, rpc, pendingRows } = makeStructuredSb({ events: [EXISTING_EVENT] });
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Perfeito, ficou agendado. A equipe vai te aguardar.",
        clientText: "ok\nobrigado",
        agendaAutomationEnabled: true,
        agendaPlan: {
          action: "create",
          date: "10/06/2026",
          time: "14:00",
          location: null,
          eventId: null,
        },
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 1,
        conversationSequence: 4,
      });
      expect(result.action).toBe("none");
      expect(result.text).toBe("Perfeito, ficou agendado. A equipe vai te aguardar.");
      expect(pendingRows).toHaveLength(0);
      expect(rpc).not.toHaveBeenCalled();
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
    });

    it("mesmo cenario, mas com horario diferente do evento ativo real: reabre confirmacao normalmente (nao regride)", async () => {
      // Garante que a nova guarda so ativa quando o horario BATE com um
      // evento real - se o modelo propoe outro horario, o fluxo normal de
      // proposta continua intacto.
      const { sb, rpc, pendingRows } = makeStructuredSb({ events: [EXISTING_EVENT] });
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Perfeito, ficou agendado. Te espero!",
        clientText: "ok\nobrigado",
        agendaAutomationEnabled: true,
        agendaPlan: {
          action: "create",
          date: "15/06/2026",
          time: "10:00",
          location: null,
          eventId: null,
        },
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 1,
        conversationSequence: 4,
      });
      expect(result.action).toBe("needs_confirmation");
      expect(pendingRows.length).toBeGreaterThan(0);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("incidente real 27/07: modelo alucina endereco novo ('Avenida Paulista, 1234') - nunca grava nem repete local nao verificado", async () => {
      // Log real da IA: o modelo inventou um endereco no campo oculto E na
      // prosa visivel simultaneamente, sem nenhuma base real (nunca foi dito
      // pelo cliente nem configurado). O tenant ja tem um endereco real e
      // recorrente usado antes ("Rua T-3, Setor Bueno, Goiania") - o novo
      // endereco alucinado nao bate com ele, entao deve ser descartado em vez
      // de gravado no evento real ou repetido pro lead como se fosse certo.
      const { sb, rpc, pendingRows } = makeStructuredSb({
        pending: {
          id: "pending-1",
          action: "create",
          event_id: null,
          proposed_date: "10/06/2026",
          proposed_time: "14:00",
          proposed_location: "Avenida Paulista, 1234",
          expires_at: "2099-01-01T00:00:00.000Z",
          state: "pending",
        },
        events: [{ ...EXISTING_EVENT, location: "Rua T-3, Setor Bueno, Goiânia" }],
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
        agendaPlan: { action: "none", date: null, time: null, location: null, eventId: null },
        operationKey: "agent-response-job:turn-location-1:1:0",
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 1,
        conversationSequence: 2,
      });
      expect(result.action).toBe("scheduled");
      expect(result.text).not.toContain("Avenida Paulista");
      expect(rpc).toHaveBeenCalledWith(
        "apply_agent_agenda_mutation_guarded",
        expect.objectContaining({ p_location: null }),
      );
    });

    it("endereco alegado pelo modelo bate com o endereco real ja usado antes: mantido normalmente (não regride)", async () => {
      const { sb, rpc } = makeStructuredSb({
        pending: {
          id: "pending-1",
          action: "create",
          event_id: null,
          proposed_date: "10/06/2026",
          proposed_time: "14:00",
          proposed_location: "Rua T-3, Setor Bueno, Goiânia",
          expires_at: "2099-01-01T00:00:00.000Z",
          state: "pending",
        },
        events: [{ ...EXISTING_EVENT, location: "Rua T-3, Setor Bueno, Goiânia" }],
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
        agendaPlan: { action: "none", date: null, time: null, location: null, eventId: null },
        operationKey: "agent-response-job:turn-location-2:1:0",
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 1,
        conversationSequence: 2,
      });
      expect(result.action).toBe("scheduled");
      expect(result.text).toContain("Rua T-3, Setor Bueno, Goiânia");
      expect(rpc).toHaveBeenCalledWith(
        "apply_agent_agenda_mutation_guarded",
        expect.objectContaining({ p_location: "Rua T-3, Setor Bueno, Goiânia" }),
      );
    });

    it("incidente real 27/07: cliente pergunta 'do que seria?' (nenhuma intencao de agenda) - convite natural do modelo passa direto, sem cobrar data/hora", async () => {
      // Log real da IA: cliente so perguntou do que se tratava o cadastro -
      // nenhum sinal de agendamento. O modelo respondeu explicando e ofereceu
      // "Posso ja deixar uma conversa presencial... agendada." (convite, sem
      // "?", sem data/hora concretas na prosa visivel) - mas o campo oculto
      // veio com uma data alucinada de 2023. O guard antigo so reconhecia
      // convite quando o modelo fazia uma PERGUNTA ("Fica bom pra voce?");
      // um convite em forma de afirmacao caia no texto engessado pedindo
      // "data e horario certinhos" para um cliente que nunca tentou agendar
      // nada - o agente parecia burlado, cobrando algo que ninguem pediu.
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText:
          "Perfeito! Seu cadastro foi sobre uma oportunidade para atuar no mercado imobiliário com a My Broker Office. Posso já deixar uma conversa presencial com um dos nossos gestores agendada.",
        clientText: "Sim\nDo que seria?",
        agendaAutomationEnabled: true,
        agendaPlan: {
          action: "propose_create",
          date: "01/11/2023",
          time: "14:00",
          location: "My Broker Office",
          eventId: null,
        },
        jobId: "33333333-3333-4333-8333-333333333333",
        claimedGeneration: 1,
        conversationSequence: 2,
      });
      expect(result.action).toBe("none");
      expect(result.text).toBe(
        "Perfeito! Seu cadastro foi sobre uma oportunidade para atuar no mercado imobiliário com a My Broker Office. Posso já deixar uma conversa presencial com um dos nossos gestores agendada.",
      );
      expect(result.text).not.toBe(AGENDA_DATETIME_NEEDED_REPLY);
      expect(pendingRows).toHaveLength(0);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("incidente real 19/07: 'ta ficando doido?' + plano 2023 → mesmo tratamento, nunca 'já passou'", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Desculpe pela confusão! 😊 Podemos agendar para amanhã às 14h. Fica bom para você?",
        clientText: "ta ficando doido?",
        agendaAutomationEnabled: true,
        agendaDisponibilidade: {
          ativo: true,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "09:00",
          horaFim: "18:00",
        },
        agendaPlan: {
          action: "propose_create",
          date: "18/10/2023",
          time: "14:00",
          location: null,
          eventId: null,
        },
      });
      expect(result.action).toBe("needs_confirmation");
      expect(result.text).not.toBe(AGENDA_PAST_DATETIME_REPLY);
      expect(pendingRows[0]).toMatchObject({
        action: "create",
        proposed_date: "02/06/2026",
        proposed_time: "14:00",
        state: "pending",
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("plano 2023 com texto do modelo SEM slot parseável → pergunta natural do modelo, zero pending", async () => {
      const { sb, rpc, pendingRows } = makeStructuredSb();
      const modelText = "Perfeito! Qual dia e horário ficam melhores para você?";
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText,
        clientText: "Uai pode ser",
        agendaAutomationEnabled: true,
        agendaDisponibilidade: {
          ativo: true,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "09:00",
          horaFim: "18:00",
        },
        agendaPlan: {
          action: "propose_create",
          date: "18/10/2023",
          time: "14:00",
          location: null,
          eventId: null,
        },
      });
      expect(result.action).toBe("none");
      expect(result.text).toBe(modelText);
      expect(pendingRows).toHaveLength(0);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("incidente real: 'Pode ser segunda agora' + plano alucinado (ano 2023) não grava proposta nem vaza hora inventada", async () => {
      const { sb, pendingRows } = makeStructuredSb();
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText: "Conseguimos te receber na segunda-feira às 14h. Fica bom para você?",
        clientText: "Pode ser segunda agora",
        agendaAutomationEnabled: true,
        agendaDisponibilidade: {
          ativo: true,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "09:00",
          horaFim: "18:00",
        },
        agendaPlan: {
          action: "propose_create",
          date: "2023-10-17",
          time: "14:00",
          location: null,
          eventId: null,
        },
      });
      expect(result.action).toBe("none");
      expect(result.text).toBe(AGENDA_DATETIME_NEEDED_REPLY);
      expect(pendingRows).toHaveLength(0);
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
    });

    it("mesmo cenário, mas o modelo pergunta genericamente (sem inventar hora): texto do modelo passa direto", async () => {
      const { sb, pendingRows } = makeStructuredSb();
      const modelText = "Perfeito! Qual dia e horário ficam melhores para você?";
      const result = await resolveAgendaTurn({
        sb,
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        timezone: "America/Sao_Paulo",
        modelText,
        clientText: "Pode ser segunda agora",
        agendaAutomationEnabled: true,
        agendaDisponibilidade: {
          ativo: true,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "09:00",
          horaFim: "18:00",
        },
        agendaPlan: {
          action: "propose_create",
          date: "2023-10-17",
          time: "14:00",
          location: null,
          eventId: null,
        },
      });
      expect(result.action).toBe("none");
      expect(result.text).toBe(modelText);
      expect(pendingRows).toHaveLength(0);
      expect(insertAgendaEventMock).not.toHaveBeenCalled();
    });

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
        sb: makeSb(EXISTING_EVENT),
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        modelText: "Seu próximo horário é 10/06 às 14:00, te aguardamos!",
        clientText: "que dia é meu horário?",
        agendaAutomationEnabled: false,
      });
      expect(result.action).toBe("listed");
      expect(result.text).toContain("Encontrei este agendamento para o seu número");
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
