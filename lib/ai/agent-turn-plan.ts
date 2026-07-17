import type { AiGenerateResult } from "@/lib/ai/types";

export type AgentAgendaPlanAction =
  | "none"
  | "list"
  | "propose_create"
  | "propose_reschedule"
  | "propose_cancel"
  | "create"
  | "reschedule"
  | "cancel";

export type AgentAgendaPlan = {
  action: AgentAgendaPlanAction;
  date: string | null;
  time: string | null;
  location: string | null;
  eventId: string | null;
};

export type AgentTurnPlan = {
  reply: string;
  agenda: AgentAgendaPlan;
};

const ACTIONS = new Set<AgentAgendaPlanAction>([
  "none",
  "list",
  "propose_create",
  "propose_reschedule",
  "propose_cancel",
  "create",
  "reschedule",
  "cancel",
]);

export const AGENT_TURN_RESPONSE_FORMAT = {
  name: "agent_turn",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: {
        type: "string",
        description: "Mensagem natural que será enviada ao cliente, sem comandos internos.",
      },
      agenda: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: [
              "none",
              "list",
              "propose_create",
              "propose_reschedule",
              "propose_cancel",
              "create",
              "reschedule",
              "cancel",
            ],
          },
          date: {
            type: ["string", "null"],
            description: "Data local obrigatoriamente no formato DD/MM/AAAA. Nunca use ISO AAAA-MM-DD.",
          },
          time: {
            type: ["string", "null"],
            description: "Horário local no formato HH:MM (24 horas).",
          },
          location: { type: ["string", "null"] },
          eventId: { type: ["string", "null"] },
        },
        required: ["action", "date", "time", "location", "eventId"],
      },
    },
    required: ["reply", "agenda"],
  },
} as const;

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A resposta estruturada é produzida por modelo e, portanto, não é confiável.
 * Aceitamos ISO apenas para converter imediatamente ao contrato interno
 * brasileiro; formatos desconhecidos viram null e nunca chegam à agenda.
 */
export function normalizeAgentAgendaDate(value: unknown): string | null {
  const raw = nullableString(value);
  if (!raw) return null;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) return null;
    return `${br[1]}/${br[2]}/${br[3]}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return normalizeAgentAgendaDate(`${iso[3]}/${iso[2]}/${iso[1]}`);
  return null;
}

export function normalizeAgentAgendaTime(value: unknown): string | null {
  const raw = nullableString(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseAgentTurnPlan(value: unknown): AgentTurnPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.reply !== "string" || !row.reply.trim()) return null;
  if (!row.agenda || typeof row.agenda !== "object" || Array.isArray(row.agenda)) return null;
  const agenda = row.agenda as Record<string, unknown>;
  if (typeof agenda.action !== "string" || !ACTIONS.has(agenda.action as AgentAgendaPlanAction)) {
    return null;
  }
  return {
    reply: row.reply.trim(),
    agenda: {
      action: agenda.action as AgentAgendaPlanAction,
      date: normalizeAgentAgendaDate(agenda.date),
      time: normalizeAgentAgendaTime(agenda.time),
      location: nullableString(agenda.location),
      eventId: nullableString(agenda.eventId),
    },
  };
}

export function normalizeAgentTurnResult(result: AiGenerateResult): AiGenerateResult {
  if (!result.ok || result.structuredData === undefined) return result;
  const plan = parseAgentTurnPlan(result.structuredData);
  if (!plan) {
    return {
      ok: false,
      code: "INVALID_STRUCTURED_REPLY",
      detail: "agent_turn_schema_mismatch",
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  }
  return { ...result, text: plan.reply, structuredData: plan };
}

export function agendaPlanFromResult(result: AiGenerateResult): AgentAgendaPlan | null {
  if (!result.ok) return null;
  return parseAgentTurnPlan(result.structuredData)?.agenda ?? null;
}
