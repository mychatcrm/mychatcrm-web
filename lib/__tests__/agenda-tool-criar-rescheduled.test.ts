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
  localWallClockToUtc: vi.fn().mockReturnValue(new Date("2099-06-02T17:00:00.000Z")),
}));

const executeAgendaDirectiveMock = vi.fn();
vi.mock("@/lib/server/agent-cta-scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agent-cta-scheduler")>();
  return {
    ...actual,
    executeAgendaDirective: (...args: unknown[]) => executeAgendaDirectiveMock(...args),
  };
});

const applyAgendaPostSuccessEffectsMock = vi.fn();
vi.mock("@/lib/server/agenda-post-success", () => ({
  applyAgendaPostSuccessEffects: (...args: unknown[]) => applyAgendaPostSuccessEffectsMock(...args),
  buildAgendaPostSuccessParams: (params: Record<string, unknown>) => params,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(() => {
    const overlapChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => overlapChain),
      })),
    };
  }),
}));

import { executarCriarAgendamento } from "@/lib/server/agenda-tool-executors";

const ctx: AgendaToolContext = {
  tenantId: "t1",
  remoteJid: "5511999990000@s.whatsapp.net",
  leadId: "lead-1",
  agentId: "agent-1",
  contactName: "Maria",
  timezone: "America/Sao_Paulo",
  followUpInteligente: null,
  lastMessage: "sim, pode confirmar",
  agentMetadata: {
    ctaHandoffAtivo: false,
    agendaLembretes: { ativo: true, regras: [{ offsetValor: 1, offsetUnidade: "dias" }] },
  },
};

describe("criar_agendamento rescheduled previousEventId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyAgendaPostSuccessEffectsMock.mockResolvedValue({ scheduleHandoffTriggered: false });
    executeAgendaDirectiveMock.mockResolvedValue({
      action: "rescheduled",
      eventId: "evt-new",
      previousEventId: "evt-old",
    });
  });

  it("passes previousEventId to post-success when directive reschedules", async () => {
    const result = await executarCriarAgendamento(ctx, {
      data: "02/06/2099",
      hora: "14:30",
      confirmacao_do_cliente: "true",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.acao).toBe("rescheduled");
    expect(result.data.event_id).toBe("evt-new");
    expect(result.data.event_id_anterior).toBe("evt-old");

    expect(applyAgendaPostSuccessEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rescheduled",
        eventId: "evt-new",
        previousEventId: "evt-old",
      }),
    );
  });

  it("exposes event_id_anterior for agendaMutation propagation", async () => {
    const result = await executarCriarAgendamento(ctx, {
      data: "02/06/2099",
      hora: "14:30",
      confirmacao_do_cliente: "true",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.event_id_anterior).toBe("evt-old");
  });

  it("allows post-success to cancel reminders for the previous event", async () => {
    await executarCriarAgendamento(ctx, {
      data: "02/06/2099",
      hora: "14:30",
      confirmacao_do_cliente: "true",
    });

    const call = applyAgendaPostSuccessEffectsMock.mock.calls[0]?.[0] as {
      action: string;
      previousEventId: string;
      metadata: { agendaLembretes: { ativo: boolean } };
    };
    expect(call.action).toBe("rescheduled");
    expect(call.previousEventId).toBe("evt-old");
    expect(call.metadata.agendaLembretes.ativo).toBe(true);
  });

  it("blocks criar without confirmacao_do_cliente", async () => {
    const result = await executarCriarAgendamento(ctx, {
      data: "02/06/2099",
      hora: "14:30",
      confirmacao_do_cliente: "false",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("confirmacao_obrigatoria");
    expect(executeAgendaDirectiveMock).not.toHaveBeenCalled();
  });
});
