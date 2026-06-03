import { describe, expect, it, vi } from "vitest";
import type { AgendaToolContext } from "@/lib/server/agenda-tool-executors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn() }));

const executeAgendaDirectiveMock = vi.fn();
vi.mock("@/lib/server/agent-cta-scheduler", () => ({
  clientConfirmedAgendaMutation: (msg: string | null | undefined) => {
    const t = (msg ?? "").trim().toLowerCase();
    if (/quero cancelar/.test(t)) return false;
    return /^\s*(sim|ok|confirmo)\b/.test(t);
  },
  executeAgendaDirective: (...args: unknown[]) => executeAgendaDirectiveMock(...args),
}));

const getAgendaEventByIdMock = vi.fn();
vi.mock("@/lib/server/google-calendar-db", () => ({
  getAgendaEventById: (...args: unknown[]) => getAgendaEventByIdMock(...args),
}));

vi.mock("@/lib/server/agenda-post-success", () => ({
  applyAgendaPostSuccessEffects: vi.fn().mockResolvedValue({ scheduleHandoffTriggered: false }),
  buildAgendaPostSuccessParams: (p: Record<string, unknown>) => p,
}));

import { executarCancelarAgendamento } from "@/lib/server/agenda-tool-executors";

const baseCtx: AgendaToolContext = {
  tenantId: "t1",
  remoteJid: "5511999990000@s.whatsapp.net",
  leadId: "lead-1",
  agentId: "agent-1",
  contactName: null,
  timezone: "America/Sao_Paulo",
  followUpInteligente: null,
};

describe("cancelar_agendamento confirmation", () => {
  it("bloqueia mutação no primeiro pedido mesmo com confirmacao_do_cliente=true", async () => {
    const result = await executarCancelarAgendamento(
      { ...baseCtx, lastMessage: "quero cancelar meu agendamento" },
      { event_id: "evt-1", confirmacao_do_cliente: "true" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("confirmacao_obrigatoria");
    expect(executeAgendaDirectiveMock).not.toHaveBeenCalled();
    expect(getAgendaEventByIdMock).not.toHaveBeenCalled();
  });

  it("cancela após confirmação explícita do cliente", async () => {
    getAgendaEventByIdMock.mockResolvedValue({
      id: "evt-1",
      status: "pending",
      attendee_phone: "5511999990000",
      lead_id: "lead-1",
      title: "Consulta",
      start_at: "2099-06-09T22:00:00.000Z",
    });
    executeAgendaDirectiveMock.mockResolvedValue({ action: "cancelled", eventId: "evt-1" });

    const result = await executarCancelarAgendamento(
      { ...baseCtx, lastMessage: "sim, pode cancelar" },
      { event_id: "evt-1", confirmacao_do_cliente: "true" },
    );
    expect(result.ok).toBe(true);
    expect(executeAgendaDirectiveMock).toHaveBeenCalled();
  });
});
