import { describe, expect, it } from "vitest";
import {
  addDaysInTimezone,
  parseAppointmentDateTime,
  resolveScheduleDateTimeFromText,
  textHasExplicitTime,
  textHasImmediateNowExpression,
  textHasInvalidExplicitTime,
} from "@/lib/server/agenda-datetime-parse";

const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-06-05T15:00:00.000Z");

describe("agenda-datetime-parse extended", () => {
  it("interpreta 'amanhã às duas horas' como 14h quando só 14h cabe na janela", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "Pode agendar para amanhã às duas horas",
      timezone: TZ,
      now: NOW,
      agendaDisponibilidade: {
        ativo: true,
        horaInicio: "09:00",
        horaFim: "15:05",
      },
    });
    expect(result).toEqual({ date: "06/06/2026", time: "14:00" });
  });

  it("daqui 3 dias = hoje + 3", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim, daqui 3 dias às 14:00",
      assistantText: "Posso confirmar para daqui 3 dias às 14:00?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 3, NOW));
    expect(result?.time).toBe("14:00");
  });

  it("daqui 15 dias = hoje + 15", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "confirmo, daqui 15 dias às 10:00",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 15, NOW));
  });

  it("próxima sexta sempre é sexta futura", () => {
    const dt = parseAppointmentDateTime({
      userMessage: "próxima sexta às 15:00",
      timezone: TZ,
      now: NOW,
    });
    expect(dt).not.toBeNull();
    const dow = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
    }).format(dt!);
    expect(dow).toBe("Fri");
    expect(dt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("dia 20 escolhe próximo dia 20 futuro", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim",
      assistantText: "Posso confirmar para dia 20 às 09:00?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toMatch(/^20\/06\/2026$/);
    expect(result?.time).toBe("09:00");
  });

  it("20/06 resolve corretamente", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim",
      assistantText: "Posso confirmar para 20/06/2026 às 11:00?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe("20/06/2026");
    expect(result?.time).toBe("11:00");
  });

  it("20 de junho resolve corretamente", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim",
      assistantText: "Posso confirmar para 20 de junho às 16:30?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe("20/06/2026");
    expect(result?.time).toBe("16:30");
  });

  it("amanhã resolve a partir de hoje", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "sim",
      assistantText: "Posso confirmar para amanhã às 08:00?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 1, NOW));
    expect(result?.time).toBe("08:00");
  });
});

describe("datas relativas respeitam integralmente o fuso do agente", () => {
  const SAME_INSTANT = new Date("2026-07-17T00:30:00.000Z");

  it("em Los Angeles ainda é dia 16, então amanhã é 17/07", () => {
    expect(resolveScheduleDateTimeFromText({
      clientText: "amanhã às 14:00",
      timezone: "America/Los_Angeles",
      now: SAME_INSTANT,
    })).toEqual({ date: "17/07/2026", time: "14:00" });
  });

  it("em Kiritimati já é dia 17, então amanhã é 18/07", () => {
    expect(resolveScheduleDateTimeFromText({
      clientText: "tomorrow at 14:00",
      assistantText: "amanhã às 14:00",
      timezone: "Pacific/Kiritimati",
      now: SAME_INSTANT,
    })).toEqual({ date: "18/07/2026", time: "14:00" });
  });
});

describe("fragmentos incompletos nunca inventam horário (incidente de produção)", () => {
  it("13:76 é inválido e nunca normaliza para 14:16", () => {
    expect(textHasInvalidExplicitTime("pode ser 13:76")).toBe(true);
    expect(textHasExplicitTime("13:76")).toBe(false);
    expect(
      resolveScheduleDateTimeFromText({
        clientText: "dia 20 às 13:76",
        timezone: TZ,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("'Pode ser hoje as' não resolve datetime (não vira o minuto atual)", () => {
    expect(
      parseAppointmentDateTime({ userMessage: "Pode ser hoje as", timezone: TZ, now: NOW }),
    ).toBeNull();
    expect(
      resolveScheduleDateTimeFromText({ clientText: "Pode ser hoje as", timezone: TZ, now: NOW }),
    ).toBeNull();
  });

  it("'quero marcar para amanhã' sem hora não resolve datetime", () => {
    expect(
      parseAppointmentDateTime({ userMessage: "quero marcar para amanhã", timezone: TZ, now: NOW }),
    ).toBeNull();
  });

  it("'sexta' sem hora não resolve datetime", () => {
    expect(
      parseAppointmentDateTime({ userMessage: "pode ser na sexta", timezone: TZ, now: NOW }),
    ).toBeNull();
  });

  it("burst consolidado 'Pode ser hoje as' + 'duas da tarde' resolve hoje às 14:00", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "Pode ser hoje as\nduas da tarde",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 0, NOW));
    expect(result?.time).toBe("14:00");
  });

  it("hora explícita continua funcionando com âncora de data", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "pode ser hoje às 16:30",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 0, NOW));
    expect(result?.time).toBe("16:30");
  });
});

describe("contexto entre jobs: complemento herda a âncora de data do turno anterior", () => {
  it("'duas da tarde' + âncora 'amanhã' de mensagem anterior → amanhã 14h (não hoje)", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "duas da tarde",
      timezone: TZ,
      now: NOW,
      recentClientMessages: ["Pode ser amanhã as", "duas da tarde"],
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 1, NOW));
    expect(result?.time).toBe("14:00");
  });

  it("usa a âncora MAIS RECENTE quando há várias datas no histórico", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "às 10h",
      timezone: TZ,
      now: NOW,
      // 'sexta' é antiga; a mais recente com âncora é 'depois de amanhã'.
      recentClientMessages: ["quero na sexta", "na verdade pode ser depois de amanhã", "às 10h"],
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 2, NOW));
    expect(result?.time).toBe("10:00");
  });

  it("quando o texto atual JÁ tem data própria, ignora o histórico", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "pode ser hoje às 09:00",
      timezone: TZ,
      now: NOW,
      recentClientMessages: ["Pode ser amanhã as"],
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 0, NOW));
    expect(result?.time).toBe("09:00");
  });

  it("histórico sem âncora de data não inventa nada além do default", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "às 15h",
      timezone: TZ,
      now: NOW,
      recentClientMessages: ["ok", "beleza", "às 15h"],
    });
    // Nenhuma âncora no histórico → cai no comportamento default (hoje).
    expect(result?.date).toBe(addDaysInTimezone(TZ, 0, NOW));
    expect(result?.time).toBe("15:00");
  });

  it("normaliza o formato real corrompido 'amanh˜' recebido da Evolution", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "três da tarde",
      timezone: TZ,
      now: NOW,
      recentClientMessages: ["pra amanh˜", "três da tarde"],
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 1, NOW));
    expect(result?.time).toBe("15:00");
  });

  it("no turno 'Confirmado' recupera data+hora dos inbounds anteriores", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "Confirmado",
      timezone: TZ,
      now: NOW,
      recentClientMessages: [
        "Oi, gostaria de agendar",
        "pra amanh˜",
        "as 3 da tarde",
        "Confirmado",
      ],
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 1, NOW));
    expect(result?.time).toBe("15:00");
  });

  it("interpreta '5 da tarde' (dígito) como 17:00", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "5 da tarde",
      timezone: TZ,
      now: NOW,
      recentClientMessages: ["próxima segunda", "5 da tarde"],
    });
    expect(result?.time).toBe("17:00");
    expect(result?.date).toBe("08/06/2026");
  });

  it("interpreta '5 da manhã' (dígito) como 05:00", () => {
    expect(textHasExplicitTime("5 da manhã")).toBe(true);
    const result = resolveScheduleDateTimeFromText({
      clientText: "amanhã 5 da manhã",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.time).toBe("05:00");
    expect(result?.date).toBe(addDaysInTimezone(TZ, 1, NOW));
  });

  it("não interpreta o artigo 'uma' em 'uma reunião' como 01:00", () => {
    expect(textHasExplicitTime("quero agendar uma reunião com o especialista")).toBe(false);
  });

  it("correção de hora do lead preserva só a data da proposta anterior", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "as 3 da tarde",
      assistantText: "Você gostaria de confirmar amanhã às 14h?",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.date).toBe(addDaysInTimezone(TZ, 1, NOW));
    expect(result?.time).toBe("15:00");
  });

  it("Amanhã as 12 hrs resolve data+hora no fuso do agente", () => {
    const result = resolveScheduleDateTimeFromText({
      clientText: "Amanhã as 12 hrs",
      timezone: TZ,
      now: NOW,
    });
    expect(result).toEqual({ date: addDaysInTimezone(TZ, 1, NOW), time: "12:00" });
    expect(textHasExplicitTime("Amanhã as 12 hrs")).toBe(true);
    expect(textHasExplicitTime("12 hs")).toBe(true);
  });

  it("âncora só de data não engole fallback date+time do modelo", () => {
    expect(
      resolveScheduleDateTimeFromText({
        clientText: "amanhã",
        timezone: TZ,
        now: NOW,
        fallbackDate: "10/06/2026",
        fallbackTime: "14:00",
      }),
    ).toBeNull();
  });

  it("pedido de agendar sem data/hora não engole fallback do modelo", () => {
    expect(
      resolveScheduleDateTimeFromText({
        clientText: "Quero agendar a entrevista",
        timezone: TZ,
        now: NOW,
        fallbackDate: "10/06/2026",
        fallbackTime: "14:00",
      }),
    ).toBeNull();
  });
});

describe("'agora'/'já' nunca vira horário — incidente 'Esse horário já passou' (captura de tela)", () => {
  it("detecta expressões de 'agora/imediato' em vários idiomas", () => {
    expect(textHasImmediateNowExpression("Nessa agora")).toBe(true);
    expect(textHasImmediateNowExpression("agora mesmo")).toBe(true);
    expect(textHasImmediateNowExpression("já")).toBe(true);
    expect(textHasImmediateNowExpression("neste momento")).toBe(true);
    expect(textHasImmediateNowExpression("right now")).toBe(true);
    expect(textHasImmediateNowExpression("ahora mismo")).toBe(true);
    expect(textHasImmediateNowExpression("maintenant")).toBe(true);
    expect(textHasImmediateNowExpression("jetzt")).toBe(true);
    expect(textHasImmediateNowExpression("adesso")).toBe(true);
    expect(textHasImmediateNowExpression("segunda-feira às 14h")).toBe(false);
  });

  it("'Nessa agora' (cenário exato da captura de tela) não engole o fallback do modelo — pede esclarecimento", () => {
    expect(
      resolveScheduleDateTimeFromText({
        clientText: "Nessa agora",
        timezone: TZ,
        now: NOW,
        // Simula o plano estruturado que o modelo teria preenchido (hoje + hora atual).
        fallbackDate: "05/06/2026",
        fallbackTime: "12:00",
      }),
    ).toBeNull();
  });

  it("'agora mesmo' sozinho também não engole o fallback do modelo", () => {
    expect(
      resolveScheduleDateTimeFromText({
        clientText: "pode ser agora mesmo",
        timezone: TZ,
        now: NOW,
        fallbackDate: "05/06/2026",
        fallbackTime: "12:00",
      }),
    ).toBeNull();
  });

  it("data/hora real continua resolvendo normalmente mesmo com a palavra 'agora' no contexto (não regressão)", () => {
    // O cliente dá uma data/hora reais no mesmo turno — clientHasAnchor/clientHasTime
    // já são true, então a veto de "agora" nunca é avaliada.
    const result = resolveScheduleDateTimeFromText({
      clientText: "pode ser segunda-feira às 14h",
      timezone: TZ,
      now: NOW,
    });
    expect(result?.time).toBe("14:00");
    expect(result?.date).not.toBeNull();
  });
});
