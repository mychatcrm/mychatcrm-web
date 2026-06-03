/**
 * Testa que criar/remarcar são bloqueados quando há conflito de horário (tenant-level).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgendaToolContext } from "@/lib/server/agenda-tool-executors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/follow-up-engine", () => ({
  isWithinBusinessHours: vi.fn().mockReturnValue(true),
  nextBusinessHourStart: vi.fn(),
}));
vi.mock("@/lib/server/agenda-datetime-parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agenda-datetime-parse")>();
  return {
    ...actual,
    localWallClockToUtc: vi.fn().mockReturnValue(new Date(Date.now() + 86400000)),
  };
});
vi.mock("@/lib/agents/agent-datetime", () => ({ parseTimezone: vi.fn().mockReturnValue("America/Sao_Paulo") }));
vi.mock("@/lib/server/agent-cta-scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agent-cta-scheduler")>();
  return {
    ...actual,
    executeAgendaDirective: vi.fn(),
    findNextActiveAgendaEvent: vi.fn(),
  };
});
vi.mock("@/lib/server/google-calendar-db", () => ({ getAgendaEventById: vi.fn(), insertAgendaEvent: vi.fn() }));

// Mock do Supabase para simular conflito
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

import { executarCriarAgendamento } from "@/lib/server/agenda-tool-executors";

const ctx: AgendaToolContext = {
  tenantId: "t1",
  remoteJid: "5511999990000@s.whatsapp.net",
  leadId: null,
  agentId: "a1",
  contactName: null,
  timezone: "America/Sao_Paulo",
  followUpInteligente: null,
  lastMessage: "sim confirmo",
};

describe("conflict guard (tenant-level)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSupabaseMock(returnData: unknown[]) {
    // Cadeia completa: select().eq().neq().lt().gt().limit()
    const limitFn = vi.fn().mockResolvedValue({ data: returnData, error: null });
    const makeChain = (): Record<string, unknown> => {
      const chain: Record<string, (...args: unknown[]) => Record<string, unknown>> = {};
      ["eq", "neq", "lt", "gt"].forEach((method) => {
        chain[method] = () => ({ ...chain, limit: limitFn });
      });
      chain.limit = limitFn;
      return chain;
    };
    const selectFn = vi.fn(() => makeChain());
    mockFrom.mockReturnValue({ select: selectFn });
    return limitFn;
  }

  it("bloqueia quando há evento sobreposto no tenant", async () => {
    makeSupabaseMock([{ id: "conflicting-evt" }]);
    const result = await executarCriarAgendamento(ctx, {
      data: "15/07/2026",
      hora: "14:00",
      confirmacao_do_cliente: "true",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("conflito_de_horario");
    }
  });

  it("permite quando não há evento sobreposto", async () => {
    makeSupabaseMock([]);

    const { executeAgendaDirective } = await import("@/lib/server/agent-cta-scheduler");
    vi.mocked(executeAgendaDirective).mockResolvedValue({ action: "scheduled", eventId: "new-evt" });

    const result = await executarCriarAgendamento(ctx, {
      data: "15/07/2026",
      hora: "14:00",
      confirmacao_do_cliente: "true",
    });
    expect(result.ok).toBe(true);
  });
});
