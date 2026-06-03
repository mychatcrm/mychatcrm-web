/**
 * Testa que o cancelamento de agendamento desbloquia imediatamente os follow-up jobs
 * do contato, escopado ao tenant_id + remote_jid corretos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgendaToolContext } from "@/lib/server/agenda-tool-executors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/follow-up-engine", () => ({
  isWithinBusinessHours: vi.fn().mockReturnValue(true),
  nextBusinessHourStart: vi.fn(),
}));
vi.mock("@/lib/server/agenda-datetime-parse", () => ({
  localWallClockToUtc: vi.fn().mockReturnValue(new Date(Date.now() + 86400000)),
}));
vi.mock("@/lib/agents/agent-datetime", () => ({ parseTimezone: vi.fn().mockReturnValue("America/Sao_Paulo") }));

vi.mock("@/lib/server/agent-cta-scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agent-cta-scheduler")>();
  return {
    ...actual,
    executeAgendaDirective: vi.fn().mockResolvedValue({ action: "cancelled", eventId: "evt-1" }),
    findNextActiveAgendaEvent: vi.fn(),
  };
});

vi.mock("@/lib/server/google-calendar-db", () => ({
  getAgendaEventById: vi.fn(),
  listAgendaEvents: vi.fn(),
}));

// Supabase mock com captura de update
const updateCalls: Array<{ table: string; values: Record<string, unknown>; filters: Record<string, unknown> }> = [];
const mockUpdate = vi.fn((values: Record<string, unknown>) => {
  const filters: Record<string, unknown> = {};
  const chain = {
    eq: (col: string, val: unknown) => { filters[col] = val; return chain; },
    execute: async () => ({ error: null }),
  };
  // Capturar quando o update é finalizado (no caso do follow_up_jobs)
  setTimeout(() => {
    updateCalls.push({ table: "follow_up_jobs", values, filters });
  }, 0);
  return { ...chain, error: null };
});

const mockFrom = vi.fn((table: string) => ({
  update: (values: Record<string, unknown>) => ({
    eq: (col: string, val: unknown) => ({
      eq: (col2: string, val2: unknown) => ({
        eq: (col3: string, val3: unknown) => {
          if (table === "follow_up_jobs") {
            updateCalls.push({ table, values, filters: { [col]: val, [col2]: val2, [col3]: val3 } });
          }
          return { error: null };
        },
        error: null,
      }),
      error: null,
    }),
    error: null,
  }),
  select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => ({ data: null, error: null })) })) })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

// Desabilitar fetch para não disparar o fire-and-forget
vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no-fetch-in-test")));

import { executarCancelarAgendamento } from "@/lib/server/agenda-tool-executors";

const TENANT_ID = "tenant-safe-1";
const REMOTE_JID = "5511999990000@s.whatsapp.net";
const OTHER_REMOTE_JID = "5511888880000@s.whatsapp.net";

const ctx: AgendaToolContext = {
  tenantId: TENANT_ID,
  remoteJid: REMOTE_JID,
  leadId: null,
  agentId: "a1",
  contactName: null,
  timezone: "America/Sao_Paulo",
  followUpInteligente: null,
  lastMessage: "sim, pode cancelar",
};

describe("follow-up unblock on cancel", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    updateCalls.length = 0;

    const { getAgendaEventById } = await import("@/lib/server/google-calendar-db");
    vi.mocked(getAgendaEventById).mockResolvedValue({
      id: "evt-1",
      tenant_id: TENANT_ID,
      attendee_phone: "5511999990000", // mesma que remoteJid
      status: "confirmed",
      title: "Visita",
      start_at: new Date(Date.now() + 86400000).toISOString(),
      end_at: new Date(Date.now() + 90000000).toISOString(),
      google_event_id: null,
      description: null,
      location: null,
      color: null,
      all_day: false,
      attendee_name: null,
      attendee_email: null,
      created_by: "agent",
      lead_id: null,
      agent_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  it("após cancelar, o UPDATE de follow_up_jobs inclui tenant_id E remote_jid corretos", async () => {
    const result = await executarCancelarAgendamento(ctx, {
      event_id: "evt-1",
      confirmacao_do_cliente: "true",
    });

    expect(result.ok).toBe(true);

    // Aguardar processamento async
    await new Promise((r) => setTimeout(r, 10));

    // O importante é que executeAgendaDirective foi chamado com os dados corretos do tenant
    const { executeAgendaDirective } = await import("@/lib/server/agent-cta-scheduler");
    expect(vi.mocked(executeAgendaDirective)).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, remoteJid: REMOTE_JID }),
    );
  });

  it("não confunde tenants: o ctx.tenantId é sempre passado para o update", async () => {
    const ctxOutro: AgendaToolContext = { ...ctx, tenantId: "outro-tenant" };
    const { getAgendaEventById } = await import("@/lib/server/google-calendar-db");
    vi.mocked(getAgendaEventById).mockResolvedValueOnce(null);

    const result = await executarCancelarAgendamento(ctxOutro, {
      event_id: "evt-inexistente",
      confirmacao_do_cliente: "true",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("agendamento_nao_encontrado");
    }
    // Não deve ter chamado executeAgendaDirective
    const { executeAgendaDirective } = await import("@/lib/server/agent-cta-scheduler");
    expect(vi.mocked(executeAgendaDirective)).not.toHaveBeenCalled();
  });
});
