import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgendaToolContext } from "@/lib/server/agenda-tool-executors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/follow-up-engine", () => ({
  isWithinBusinessHours: vi.fn().mockReturnValue(true),
  nextBusinessHourStart: vi.fn(),
}));
vi.mock("@/lib/agents/agent-datetime", () => ({
  parseTimezone: vi.fn().mockReturnValue("America/Sao_Paulo"),
}));
vi.mock("@/lib/server/agenda-datetime-parse", () => ({
  localWallClockToUtc: vi.fn().mockReturnValue(new Date("2099-06-10T22:00:00.000Z")),
  parseRelativeDaysOffset: vi.fn().mockReturnValue(null),
  addDaysInTimezone: vi.fn(),
}));

const executeAgendaDirectiveMock = vi.fn();
vi.mock("@/lib/server/agent-cta-scheduler", () => ({
  clientConfirmedAgendaMutation: vi.fn((msg: string | null | undefined) => {
    const t = (msg ?? "").trim().toLowerCase();
    return /^\s*(sim|ok|confirmo)\b/.test(t);
  }),
  executeAgendaDirective: (...args: unknown[]) => executeAgendaDirectiveMock(...args),
  findNextActiveAgendaEvent: vi.fn(),
}));

const getAgendaEventByIdMock = vi.fn();
vi.mock("@/lib/server/google-calendar-db", () => ({
  getAgendaEventById: (...args: unknown[]) => getAgendaEventByIdMock(...args),
}));

vi.mock("@/lib/server/agenda-post-success", () => ({
  applyAgendaPostSuccessEffects: vi.fn().mockResolvedValue({ scheduleHandoffTriggered: false }),
  buildAgendaPostSuccessParams: (p: Record<string, unknown>) => p,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(() => {
    const limitFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const makeChain = (): Record<string, unknown> => {
      const chain: Record<string, (...args: unknown[]) => Record<string, unknown>> = {};
      ["eq", "neq", "lt", "gt"].forEach((method) => {
        chain[method] = () => ({ ...chain, limit: limitFn });
      });
      chain.limit = limitFn;
      return chain;
    };
    return { from: vi.fn(() => ({ select: vi.fn(() => makeChain()) })) };
  }),
}));

import { executarRemarcarAgendamento } from "@/lib/server/agenda-tool-executors";

const ctx: AgendaToolContext = {
  tenantId: "t1",
  remoteJid: "5511999990000@s.whatsapp.net",
  leadId: "lead-1",
  agentId: "agent-1",
  contactName: "Maria",
  timezone: "America/Sao_Paulo",
  followUpInteligente: null,
  lastMessage: "sim, confirmo a remarcação",
};

describe("remarcar_agendamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAgendaEventByIdMock.mockResolvedValue({
      id: "evt-old",
      status: "pending",
      attendee_phone: "5511999990000",
      lead_id: "lead-1",
      location: "MB Office",
      start_at: "2099-06-09T22:00:00.000Z",
    });
    executeAgendaDirectiveMock.mockResolvedValue({
      action: "rescheduled",
      eventId: "evt-new",
      previousEventId: "evt-old",
    });
  });

  it("não muta sem confirmação explícita do cliente no inbound", async () => {
    const result = await executarRemarcarAgendamento(
      { ...ctx, lastMessage: "quero remarcar para quinta" },
      {
        event_id: "evt-old",
        nova_data: "12/06/2099",
        nova_hora: "19:00",
        confirmacao_do_cliente: "true",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("confirmacao_obrigatoria");
    expect(executeAgendaDirectiveMock).not.toHaveBeenCalled();
  });

  it("persiste remarcação no event_id informado com data correta", async () => {
    const result = await executarRemarcarAgendamento(ctx, {
      event_id: "evt-old",
      nova_data: "12/06/2099",
      nova_hora: "19:00",
      confirmacao_do_cliente: "true",
    });
    expect(result.ok).toBe(true);
    expect(executeAgendaDirectiveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        remoteJid: "5511999990000@s.whatsapp.net",
        replaceEventId: "evt-old",
        directive: { type: "schedule", date: "12/06/2099", time: "19:00", location: "MB Office" },
      }),
    );
  });
});
