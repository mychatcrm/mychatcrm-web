import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAgentAgendaOutboundPlan } from "@/lib/server/agent-cta-scheduler";
import { AGENDA_CALENDAR_FACT_DAYS, buildAgendaCalendarFacts } from "@/lib/agents/agenda-calendar-facts";
import { buildRequestedDateFactBlock } from "@/lib/server/agent-agenda-context";
import type { AgentAgendaPlan } from "@/lib/ai/agent-turn-plan";

/**
 * Incidente real: o lead pediu "dia 30", o agente respondeu que não atende aos
 * sábados — e 30/09/2026 é QUARTA-FEIRA, dia plenamente atendido. O lead foi
 * recusado por um dia da semana que o modelo inventou.
 *
 * Duas falhas somadas produziram isso:
 *  1. CALENDAR FACTS cobria só 15 dias; fora disso o modelo calculava de
 *     cabeça e errava (30/09 caiu num sábado em 2023, ano de treino).
 *  2. checkAgentAgendaOutboundPlan só conferia dia da semana no ramo
 *     create/reschedule. Ao RECUSAR (action="none", sem date), a checagem era
 *     pulada — mentira nenhuma era barrada.
 *
 * Estes testes travam as duas pontas.
 */

const TZ = "America/Sao_Paulo";
const SEG_A_SEX = { ativo: true, diasSemana: [1, 2, 3, 4, 5], horaInicio: "08:00", horaFim: "18:00" };
const NONE: AgentAgendaPlan = { action: "none", date: null, time: null, location: null, eventId: null };

const check = (reply: string, clientText: string, plan: AgentAgendaPlan = NONE, now?: Date) =>
  checkAgentAgendaOutboundPlan({
    plan, reply, timezone: TZ, agendaDisponibilidade: SEG_A_SEX, clientText,
    now: now ?? new Date("2026-09-16T12:00:00Z"),
  });

const weekdayOf = (d: string) => {
  const [day, month, year] = d.split("/").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, 12)).getUTCDay();
};

describe("recusa de agenda não pode mentir o dia da semana", () => {
  it("barra a mentira exata do incidente (dia 30 é quarta, agente disse sábado)", () => {
    expect(weekdayOf("30/09/2026")).toBe(3); // quarta
    const result = check(
      "Infelizmente dia 30 cai num sábado e não atendemos aos sábados. Pode ser outro dia?",
      "pode ser dia 30?",
    );
    expect(result).toEqual({ ok: false, errorReason: "agenda_reply_weekday_mismatch" });
  });

  it.each([
    ["pode ser dia 30?", "Dia 30, que é sábado, infelizmente não dá."],
    ["pode ser dia 30?", "Sábado, dia 30, estamos fechados."],
    ["pode ser dia 30?", "Não abrimos no sábado (30/09)."],
    ["pode ser dia 30?", "O dia 30 será um domingo, não atendemos."],
  ])("barra atribuição errada de dia da semana: %s → %s", (clientText, reply) => {
    expect(check(reply, clientText).ok).toBe(false);
  });

  it.each([
    ["30/09", "No dia 30/09 é sábado, não trabalhamos."],
    ["30/09/2026", "Dia 30/09/2026 seria um domingo, infelizmente."],
    ["dia 30 desse mês", "O dia 30 é uma segunda-feira e segunda estamos fechados."],
    ["queria dia 30 de setembro", "Dia 30 de setembro cai numa sexta? Não atendemos sexta."],
  ])("barra mentira quando o lead diz %s", (clientText, reply) => {
    expect(check(reply, clientText).ok).toBe(false);
  });

  it.each([
    ["en", "Day 30 falls on a Saturday, we are closed."],
    ["es", "El día 30 cae en sábado y no atendemos."],
    ["fr", "Le 30 tombe un samedi, nous sommes fermés."],
  ])("barra mentira em %s", (_lang, reply) => {
    expect(check(reply, "pode ser dia 30?").ok).toBe(false);
  });

  it("aceita quando o agente acerta o dia da semana", () => {
    expect(check("Dia 30 é quarta-feira, temos horário sim!", "pode ser dia 30?").ok).toBe(true);
  });

  it("aceita recusa legítima: a data realmente cai em dia não atendido", () => {
    // 03/10/2026 é sábado de verdade.
    expect(weekdayOf("03/10/2026")).toBe(6);
    const result = check(
      "Dia 3 do mês que vem cai num sábado e não atendemos aos sábados.",
      "pode ser dia 3 do mês que vem?",
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    "Não atendemos aos sábados nem domingos. Mas dia 30 temos horário livre!",
    "Não atendemos aos sábados, mas dia 30 temos horário sim!",
    "Funcionamos de segunda a sexta; dia 30 está livre.",
    "Aos sábados e domingos ficamos fechados — dia 30 podemos sim.",
    "Temos vaga dia 30 e sábado que vem também.",
    "No sábado não dá, mas te encaixo dia 30 de manhã.",
  ])("não confunde política de atendimento com afirmação sobre a data: %s", (reply) => {
    // Menciona dia da semana E a data, mas não ATRIBUI um ao outro — é verdade
    // e não pode ser barrado, senão o lead recebe a resposta robótica de erro.
    expect(check(reply, "pode ser dia 30?").ok).toBe(true);
  });

  it("não confunde horário com número do dia", () => {
    // "10h30"/"10:30" não podem ser lidos como "dia 30".
    for (const reply of ["Sábado só atendemos até 10h30.", "No sábado fechamos 10:30."]) {
      expect(check(reply, "pode ser dia 12?").ok).toBe(true);
    }
  });

  it("sem data na fala do lead, nada é barrado (não há referência para conferir)", () => {
    expect(check("Não atendemos aos sábados.", "vocês atendem sábado?").ok).toBe(true);
  });

  it("continua barrando mentira no ramo create/reschedule (comportamento antigo intacto)", () => {
    const plan: AgentAgendaPlan = {
      action: "propose_create", date: "30/09/2026", time: "10:00", location: null, eventId: null,
    };
    const result = check("Marquei dia 30/09/2026 às 10:00, um sábado.", "pode ser dia 30?", plan);
    expect(result).toEqual({ ok: false, errorReason: "agenda_reply_weekday_mismatch" });
  });

  it("barra mentira também em cancelamento", () => {
    const plan: AgentAgendaPlan = { action: "propose_cancel", date: null, time: null, location: null, eventId: "evt_1" };
    expect(check("Seu horário do dia 30, que é sábado, será cancelado.", "cancela o dia 30", plan).ok).toBe(false);
  });
});

describe("CALENDAR FACTS cobrem o horizonte real de agendamento", () => {
  it("entrega 60 dias, não 15", () => {
    expect(AGENDA_CALENDAR_FACT_DAYS).toBe(60);
    const data = JSON.parse(buildAgendaCalendarFacts(TZ, new Date("2026-09-16T12:00:00Z"))!.replace(/^[^{]+/, ""));
    expect(data.days).toHaveLength(60);
  });

  it("cobre dia 30 mesmo numa conversa iniciada 20 dias antes (o furo do incidente)", () => {
    const data = JSON.parse(buildAgendaCalendarFacts(TZ, new Date("2026-09-05T12:00:00Z"))!.replace(/^[^{]+/, ""));
    expect(data.days).toContain("2026-09-30:3"); // quarta
  });

  it("custa muito menos por dia coberto que o formato antigo", () => {
    const facts = buildAgendaCalendarFacts(TZ, new Date("2026-09-16T12:00:00Z"))!;
    // Antes: 888 chars para 15 dias = ~59 chars/dia (um objeto JSON por dia).
    // Agora: formato "YYYY-MM-DD:weekday" = ~18 chars/dia. Quadruplicamos a
    // cobertura por ~20% a mais de contexto total.
    const charsPorDia = facts.length / AGENDA_CALENDAR_FACT_DAYS;
    expect(charsPorDia).toBeLessThan(59 / 3);
    expect(facts.length).toBeLessThan(888 * 1.5);
  });

  it("todo dia declarado tem o weekday correto, em qualquer fuso", () => {
    for (const zone of ["America/Sao_Paulo", "UTC", "Asia/Tokyo", "Pacific/Kiritimati", "America/Los_Angeles"]) {
      const data = JSON.parse(buildAgendaCalendarFacts(zone, new Date("2026-09-16T12:00:00Z"))!.replace(/^[^{]+/, ""));
      for (const entry of data.days as string[]) {
        const [date, weekday] = entry.split(":");
        expect(new Date(`${date}T12:00:00Z`).getUTCDay()).toBe(Number(weekday));
      }
    }
  });
});

describe("REQUESTED DATE FACT entrega o dia da semana pronto ao modelo", () => {
  const now = new Date("2026-09-16T12:00:00Z");

  it("resolve a data do incidente com o dia correto", () => {
    const block = buildRequestedDateFactBlock({ clientText: "pode ser dia 30?", timezone: TZ, now })!;
    expect(block).toContain("30/09/2026");
    expect(block).toContain("Wednesday");
    expect(block).toContain("quarta-feira");
    // "Saturday" só pode aparecer na legenda da convenção, nunca como o dia.
    expect(block).toContain("weekday 3");
    expect(block).not.toContain("falls on weekday 6");
  });

  it("não inventa fato quando não há data na mensagem", () => {
    expect(buildRequestedDateFactBlock({ clientText: "bom dia, tudo bem?", timezone: TZ, now })).toBeNull();
    expect(buildRequestedDateFactBlock({ clientText: "", timezone: TZ, now })).toBeNull();
    expect(buildRequestedDateFactBlock({ clientText: null, timezone: TZ, now })).toBeNull();
  });

  it("o dia da semana declarado sempre confere com o calendário real", () => {
    const nomes = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (let dia = 1; dia <= 28; dia++) {
      const block = buildRequestedDateFactBlock({ clientText: `pode ser dia ${dia}?`, timezone: TZ, now });
      if (!block) continue;
      const data = block.match(/Date requested: (\d{2}\/\d{2}\/\d{4})/)![1]!;
      expect(block).toContain(nomes[weekdayOf(data)]!);
    }
  });
});

/**
 * A correção só vale se estiver LIGADA no pipeline. Um refactor que remova a
 * injeção do fato ou pare de passar a fala do cliente ao validador reabre o
 * incidente em silêncio — sem quebrar nenhum teste de unidade.
 */
describe("a correção está conectada no runtime", () => {
  const source = readFileSync(join(process.cwd(), "lib/ai/generate-agent-response.ts"), "utf8");

  it("injeta o REQUESTED DATE FACT nos blocos de sistema de todas as chamadas do turno", () => {
    expect(source).toContain("buildRequestedDateFactBlock");
    const inicio = source.indexOf("requiredSystemBlocks:");
    expect(inicio).toBeGreaterThan(-1);
    expect(source.slice(inicio, inicio + 400)).toContain("requestedDateFactBlock");
  });

  it("passa a fala do cliente ao validador de saída, nas duas tentativas", () => {
    const chamadas = source.match(/checkAgentAgendaOutboundPlan\(\{[^}]*\}\)/gs) ?? [];
    expect(chamadas.length).toBeGreaterThanOrEqual(2);
    for (const chamada of chamadas) expect(chamada).toContain("clientText");
  });

  it("o prompt não manda mais o modelo calcular dia da semana sozinho", () => {
    const prompt = readFileSync(join(process.cwd(), "lib/ai/agent-system-prompt.ts"), "utf8");
    expect(prompt).not.toContain("calcule ambos no fuso configurado");
    expect(prompt).toContain("NUNCA calcule dia da semana de cabeça");
  });
});

/**
 * Certificação determinística: varre meses, dias e fusos provando as duas
 * invariantes que sustentam a correção — o fato nunca mente, e uma recusa que
 * contradiz o calendário nunca passa.
 */
describe("certificação massiva de calendário", () => {
  it("valida dezenas de milhares de combinações de data, fuso e afirmação de dia da semana", () => {
    const zones = ["America/Sao_Paulo", "UTC", "Asia/Tokyo", "Europe/Lisbon", "America/New_York"];
    const nomesPt = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
    let verificados = 0;

    for (const zone of zones) {
      for (let mes = 0; mes < 12; mes++) {
        for (let dia = 1; dia <= 28; dia++) {
          const now = new Date(Date.UTC(2026, mes, 1, 12));
          const block = buildRequestedDateFactBlock({ clientText: `pode ser dia ${dia}?`, timezone: zone, now });
          if (!block) continue;
          const dataResolvida = block.match(/Date requested: (\d{2}\/\d{2}\/\d{4})/)![1]!;
          const real = weekdayOf(dataResolvida);

          // Invariante 1: o fato entregue ao modelo nunca mente.
          expect(block).toContain(nomesPt[real]!);

          const avalia = (reply: string) =>
            checkAgentAgendaOutboundPlan({
              plan: NONE, reply, timezone: zone, agendaDisponibilidade: SEG_A_SEX,
              clientText: `pode ser dia ${dia}?`, now,
            }).ok;

          // Invariante 2: ATRIBUIR à data qualquer outro dia da semana é sempre
          // barrado — nas várias formas que o modelo usa para dizer isso.
          for (let errado = 0; errado < 7; errado++) {
            if (errado === real) continue;
            const nome = nomesPt[errado]!;
            for (const mentira of [
              `O dia ${dia} cai num ${nome} e não atendemos.`,
              `Dia ${dia}, que é ${nome}, infelizmente não dá.`,
              `O dia ${dia} será um ${nome}.`,
              `${nome}, dia ${dia}, estamos fechados.`,
            ]) {
              expect(avalia(mentira)).toBe(false);
              verificados++;
            }
          }

          // Invariante 3: afirmar o dia CORRETO nunca é barrado.
          expect(avalia(`O dia ${dia} cai num ${nomesPt[real]}.`)).toBe(true);
          verificados++;

          // Invariante 4 (falso positivo é tão grave quanto a mentira): citar
          // política de atendimento junto da data, sem atribuir um ao outro,
          // precisa passar. Barrar isso jogaria o lead no texto de erro.
          for (const legitimo of [
            `Não atendemos aos ${nomesPt[6]}s nem ${nomesPt[0]}s, mas dia ${dia} temos horário!`,
            `Funcionamos de ${nomesPt[1]} a ${nomesPt[5]}; dia ${dia} está livre.`,
            `No ${nomesPt[6]} não dá, mas te encaixo dia ${dia} de manhã.`,
          ]) {
            expect(avalia(legitimo)).toBe(true);
            verificados++;
          }
        }
      }
    }
    expect(verificados).toBeGreaterThan(10_000);
  }, 120_000);
});
