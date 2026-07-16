import type { AiGenerateResult } from "@/lib/ai/types";

export type AgentAgendaPlanAction =
  | "none"
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
              "propose_create",
              "propose_reschedule",
              "propose_cancel",
              "create",
              "reschedule",
              "cancel",
            ],
          },
          date: { type: ["string", "null"] },
          time: { type: ["string", "null"] },
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
      date: nullableString(agenda.date),
      time: nullableString(agenda.time),
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
