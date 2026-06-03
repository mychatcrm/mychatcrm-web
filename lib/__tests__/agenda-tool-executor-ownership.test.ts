/**
 * Testa que os executores rejeitam ações em eventos que não pertencem ao contato.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgendaToolContext } from "@/lib/server/agenda-tool-executors";

// Mock das dependências do servidor
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock("@/lib/server/google-calendar-db", () => ({
  getAgendaEventById: vi.fn(),
  listAgendaEvents: vi.fn(),
}));
vi.mock("@/lib/server/agent-cta-scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agent-cta-scheduler")>();
  return { ...actual, executeAgendaDirective: vi.fn(), findNextActiveAgendaEvent: vi.fn() };
});
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
vi.mock("@/lib/agents/agent-datetime", () => ({
  parseTimezone: vi.fn().mockReturnValue("America/Sao_Paulo"),
}));

import { executarCancelarAgendamento, executarRemarcarAgendamento } from "@/lib/server/agenda-tool-executors";
import { getAgendaEventById } from "@/lib/server/google-calendar-db";

const makeCtx = (remoteJid = "5511999990000@s.whatsapp.net"): AgendaToolContext => ({
  tenantId: "tenant-1",
  remoteJid,
  leadId: null,
  agentId: "agent-1",
  contactName: "João",
  timezone: "America/Sao_Paulo",
  followUpInteligente: null,
  lastMessage: "sim confirmo",
});

describe("executor ownership guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancelar_agendamento: rejeita quando attendee_phone não bate com contato atual", async () => {
    vi.mocked(getAgendaEventById).mockResolvedValue({
      id: "evt-1",
      tenant_id: "tenant-1",
      attendee_phone: "5511888880000", // telefone diferente
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

    const result = await executarCancelarAgendamento(makeCtx(), {
      event_id: "evt-1",
      confirmacao_do_cliente: "true",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("agendamento_nao_pertence_ao_contato");
    }
  });

  it("remarcar_agendamento: rejeita quando attendee_phone não bate", async () => {
    vi.mocked(getAgendaEventById).mockResolvedValue({
      id: "evt-2",
      tenant_id: "tenant-1",
      attendee_phone: "5511777770000", // diferente
      status: "confirmed",
      title: "Reunião",
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

    const result = await executarRemarcarAgendamento(makeCtx(), {
      event_id: "evt-2",
      nova_data: "25/12/2026",
      nova_hora: "10:00",
      confirmacao_do_cliente: "true",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("agendamento_nao_pertence_ao_contato");
    }
  });
});
