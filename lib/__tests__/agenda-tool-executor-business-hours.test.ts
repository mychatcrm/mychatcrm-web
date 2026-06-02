/**
 * Testa que criar/remarcar são bloqueados fora do horário comercial quando configurado.
 */
import { describe, it, expect, vi } from "vitest";
import type { AgendaToolContext } from "@/lib/server/agenda-tool-executors";
import type { AgentFollowUpInteligente } from "@/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock("@/lib/server/google-calendar-db", () => ({ getAgendaEventById: vi.fn(), listAgendaEvents: vi.fn(), insertAgendaEvent: vi.fn() }));
vi.mock("@/lib/server/agent-cta-scheduler", () => ({ executeAgendaDirective: vi.fn(), findNextActiveAgendaEvent: vi.fn() }));
vi.mock("@/lib/server/agenda-datetime-parse", () => ({
  localWallClockToUtc: vi.fn().mockReturnValue(new Date(Date.now() + 86400000)),
}));
vi.mock("@/lib/agents/agent-datetime", () => ({ parseTimezone: vi.fn().mockReturnValue("America/Sao_Paulo") }));

// Simula horário fora do comercial
vi.mock("@/lib/server/follow-up-engine", () => ({
  isWithinBusinessHours: vi.fn().mockReturnValue(false),
  nextBusinessHourStart: vi.fn().mockReturnValue(new Date("2026-07-15T12:00:00Z")),
}));

import { executarCriarAgendamento, executarVerificarDisponibilidade } from "@/lib/server/agenda-tool-executors";

const followUpCom: AgentFollowUpInteligente = {
  ativo: true,
  usarHorarioComercial: true,
  horaInicio: 8,
  horaFim: 18,
  diasAtivos: [1, 2, 3, 4, 5],
  tentativasContato: 3,
  intervaloVerificacaoMinutos: 60,
  modo: "moderado",
  cooldownAtivo: false,
  cooldownMinutos: 0,
  respeitarHumanoAtivo: true,
  retomadaApenasSeHumanoAbandonou: false,
  bloquearSeLeadRespondeu: true,
  bloquearTarefaFutura: true,
  bloquearStatusPerdido: true,
  permitirSlaVencido: false,
  slaHorasResposta: null,
  desativarAposEncerrar: false,
  usarDadosFormularioMeta: false,
  usarHistoricoCrm: false,
  usarHistoricoWhatsapp: true,
};

const ctx: AgendaToolContext = {
  tenantId: "t1",
  remoteJid: "5511999990000@s.whatsapp.net",
  leadId: null,
  agentId: "a1",
  contactName: null,
  timezone: "America/Sao_Paulo",
  followUpInteligente: followUpCom,
};

describe("business hours guard", () => {
  it("criar_agendamento bloqueia fora do horário", async () => {
    const result = await executarCriarAgendamento(ctx, { data: "15/07/2026", hora: "23:00" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("fora_horario_comercial");
      expect(result.sugestao).toBeDefined();
    }
  });

  it("verificar_disponibilidade reporta fora do horário com sugestão", async () => {
    const result = await executarVerificarDisponibilidade(ctx, { data: "15/07/2026", hora: "23:00" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("fora_horario_comercial");
    }
  });
});
