import { describe, expect, it } from "vitest";
import { checkAgendaPlanDateTime } from "@/lib/server/agent-cta-scheduler";
import type { AgentAgendaDisponibilidade } from "@/lib/types";

const DISP: AgentAgendaDisponibilidade = {
  ativo: true,
  diasSemana: [1, 2, 3, 4, 5],
  horaInicio: "09:00",
  horaFim: "18:00",
};

// Domingo 16/08/2026 21:41 — mesmo instante do incidente real.
const NOW = new Date("2026-08-17T00:41:00.000Z");

describe("checkAgendaPlanDateTime", () => {
  it("regressão de produção: rejeita 15/11/2023 — data que o modelo alucinou pro cliente My Broker Office", () => {
    const result = checkAgendaPlanDateTime({
      date: "15/11/2023",
      time: "14:00",
      timezone: "America/Sao_Paulo",
      agendaDisponibilidade: DISP,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, errorReason: "invalid_or_past_agenda_datetime" });
  });

  it("rejeita data válida no calendário mas no passado em relação a agora", () => {
    const result = checkAgendaPlanDateTime({
      date: "10/08/2026",
      time: "14:00",
      timezone: "America/Sao_Paulo",
      agendaDisponibilidade: DISP,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, errorReason: "invalid_or_past_agenda_datetime" });
  });

  it("aceita data futura dentro da disponibilidade configurada", () => {
    // Segunda-feira 17/08/2026, dentro de seg-sex 09h-18h.
    const result = checkAgendaPlanDateTime({
      date: "17/08/2026",
      time: "14:00",
      timezone: "America/Sao_Paulo",
      agendaDisponibilidade: DISP,
      now: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejeita data futura que cai num dia fora da disponibilidade (sábado)", () => {
    // 22/08/2026 é sábado — diasSemana só permite seg-sex.
    const result = checkAgendaPlanDateTime({
      date: "22/08/2026",
      time: "14:00",
      timezone: "America/Sao_Paulo",
      agendaDisponibilidade: DISP,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, errorReason: "outside_agenda_availability" });
  });

  it("rejeita horário fora da janela configurada", () => {
    const result = checkAgendaPlanDateTime({
      date: "17/08/2026",
      time: "20:00",
      timezone: "America/Sao_Paulo",
      agendaDisponibilidade: DISP,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, errorReason: "outside_agenda_availability" });
  });

  it("rejeita data ausente ou mal formatada", () => {
    expect(
      checkAgendaPlanDateTime({ date: null, time: "14:00", timezone: "America/Sao_Paulo", now: NOW }),
    ).toEqual({ ok: false, errorReason: "agenda_datetime_needed" });
    expect(
      checkAgendaPlanDateTime({ date: "31/02/2026", time: "14:00", timezone: "America/Sao_Paulo", now: NOW }),
    ).toEqual({ ok: false, errorReason: "agenda_datetime_needed" });
  });

  it("sem disponibilidade configurada (ou desligada), só valida passado — qualquer dia/hora futuro passa", () => {
    const resultNoDisp = checkAgendaPlanDateTime({
      date: "22/08/2026",
      time: "20:00",
      timezone: "America/Sao_Paulo",
      now: NOW,
    });
    expect(resultNoDisp).toEqual({ ok: true });

    const resultDispOff = checkAgendaPlanDateTime({
      date: "22/08/2026",
      time: "20:00",
      timezone: "America/Sao_Paulo",
      agendaDisponibilidade: { ...DISP, ativo: false },
      now: NOW,
    });
    expect(resultDispOff).toEqual({ ok: true });
  });
});
