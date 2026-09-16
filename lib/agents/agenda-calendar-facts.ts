import { isValidIanaTimezone } from "@/lib/agents/agent-datetime";

/**
 * Quantos dias civis o modelo recebe com o dia da semana já calculado.
 *
 * Eram 15 e isso causou incidente real: o lead pedia uma data além da janela
 * (ex.: "dia 30" faltando 20 dias), o modelo não tinha o fato e chutava o dia
 * da semana — chutando pela aritmética memorizada no treino (30/09 caiu num
 * sábado em 2023, não em 2026). Ele então recusava a data dizendo "não
 * atendemos aos sábados" para uma quarta-feira perfeitamente atendida.
 *
 * 60 dias cobre o horizonte real de agendamento sem custar mais contexto: o
 * formato compacto abaixo gasta menos tokens com 60 dias do que o formato
 * antigo (objeto por dia) gastava com 15.
 */
export const AGENDA_CALENDAR_FACT_DAYS = 60;

/** Civil dates only: not availability, a preferred slot or business policy. */
export function buildAgendaCalendarFacts(timezone: string, now = new Date()): string | null {
  if (!isValidIanaTimezone(timezone) || !Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const civil = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  const days = Array.from({ length: AGENDA_CALENDAR_FACT_DAYS }, (_, offset) => {
    const day = new Date(civil);
    day.setUTCDate(day.getUTCDate() + offset);
    return `${day.toISOString().slice(0, 10)}:${day.getUTCDay()}`;
  });
  return `CALENDAR FACTS (not availability or a maximum booking horizon): ${JSON.stringify({
    timezone,
    weekdayConvention: "0=Sunday..6=Saturday",
    entryFormat: "YYYY-MM-DD:weekday",
    days,
  })}`;
}
