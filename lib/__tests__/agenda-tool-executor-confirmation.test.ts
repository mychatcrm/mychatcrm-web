/**
 * Testa que cancelar e remarcar são bloqueados sem confirmacao_do_cliente='true'.
 */
import { describe, it, expect, vi } from "vitest";
import type { AgendaToolContext } from "@/lib/server/agenda-tool-executors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock("@/lib/server/google-calendar-db", () => ({ getAgendaEventById: vi.fn(), listAgendaEvents: vi.fn() }));
vi.mock("@/lib/server/agent-cta-scheduler", () => ({ executeAgendaDirective: vi.fn(), findNextActiveAgendaEvent: vi.fn() }));
vi.mock("@/lib/server/follow-up-engine", () => ({ isWithinBusinessHours: vi.fn().mockReturnValue(true), nextBusinessHourStart: vi.fn() }));
vi.mock("@/lib/server/agenda-datetime-parse", () => ({ localWallClockToUtc: vi.fn().mockReturnValue(new Date(Date.now() + 86400000)) }));
vi.mock("@/lib/agents/agent-datetime", () => ({ parseTimezone: vi.fn().mockReturnValue("America/Sao_Paulo") }));

import { executarCancelarAgendamento, executarRemarcarAgendamento } from "@/lib/server/agenda-tool-executors";

const ctx: AgendaToolContext = {
  tenantId: "t1",
  remoteJid: "5511999990000@s.whatsapp.net",
  leadId: null,
  agentId: "a1",
  contactName: null,
  timezone: "America/Sao_Paulo",
  followUpInteligente: null,
};

describe("confirmation guard", () => {
  it("cancelar bloqueia quando confirmacao_do_cliente='false'", async () => {
    const result = await executarCancelarAgendamento(ctx, {
      event_id: "evt-1",
      confirmacao_do_cliente: "false",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("confirmacao_obrigatoria");
  });

  it("cancelar bloqueia quando confirmacao_do_cliente ausente", async () => {
    const result = await executarCancelarAgendamento(ctx, {
      event_id: "evt-1",
      confirmacao_do_cliente: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("confirmacao_obrigatoria");
  });

  it("remarcar bloqueia quando confirmacao_do_cliente='false'", async () => {
    const result = await executarRemarcarAgendamento(ctx, {
      event_id: "evt-1",
      nova_data: "20/07/2026",
      nova_hora: "10:00",
      confirmacao_do_cliente: "false",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("confirmacao_obrigatoria");
  });
});
