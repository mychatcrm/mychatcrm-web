import type { Agent, AgentFollowUpInteligente } from "@/lib/types";

const VALID_IANA_RE = /^[A-Za-z]+(?:\/[A-Za-z_]+){0,2}$/;

// Sem fuso salvo (ou valor ilegível), cai no padrão da plataforma —
// América/São Paulo, não UTC. Público majoritariamente brasileiro: cair em
// UTC adiantava a janela comercial do follow-up em 3h sem o cliente notar.
const FALLBACK_TIMEZONE = "America/Sao_Paulo";

export function parseTimezone(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return FALLBACK_TIMEZONE;
  const tz = raw.trim();
  if (!VALID_IANA_RE.test(tz)) return FALLBACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

export function resolveAgentTimezone(
  agent: Partial<Agent> & { followUpInteligente?: AgentFollowUpInteligente | null },
): string {
  if (typeof agent.timezone === "string" && agent.timezone.trim()) {
    return parseTimezone(agent.timezone);
  }
  return parseTimezone(agent.followUpInteligente?.timezone);
}

function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDateTimeParts(timezone: string, now = new Date()) {
  const tz = parseTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value?.trim() ?? "";

  return {
    tz,
    weekday: capitalizeFirst(get("weekday")),
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Linha injetada no system prompt com data/hora no fuso do agente. */
export function formatCurrentDateTimeLine(timezone: string, now = new Date()): string {
  const { tz, weekday, day, month, year, hour, minute } = formatDateTimeParts(timezone, now);
  return `Data e hora atual: ${weekday}, ${day} de ${month} de ${year}, ${hour}:${minute} (${tz})`;
}

/** Bloco técnico no final do prompt — contexto de data/hora sem influenciar tom de confirmação. */
export function formatSystemDateTimeContextBlock(timezone: string, now = new Date()): string {
  const { tz, weekday, day, month, year, hour, minute } = formatDateTimeParts(timezone, now);
  return `[CONTEXTO DO SISTEMA: Data e hora atual: ${weekday}, ${day} de ${month} de ${year}, ${hour}:${minute} (${tz}). Use SEMPRE esta data/hora como referência para qualquer cálculo de data — agendamentos, "amanhã", "semana que vem", "dia X" etc. devem ser calculados a partir desta data.]`;
}
