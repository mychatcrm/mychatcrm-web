import type { AiGenerateResult } from "@/lib/ai/types";
import type { AgentExternalApiLookupRequest } from "@/lib/external-api/types";

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

/**
 * Desfecho do lead declarado pelo agente no turno.
 *
 * `disqualified` = não atende os critérios do negócio; `lost_interest` = desistiu
 * do que procurava. Os dois são terminais: quando o dono do agente configura, o
 * card muda de coluna e o atendimento automático para.
 *
 * O modelo só pode declarar isso quando o operador escreveu os critérios do
 * próprio negócio no agente — o prompt proíbe explicitamente caso contrário.
 */
export type AgentLeadOutcomeAction = "none" | "disqualified" | "lost_interest";

export type AgentLeadOutcome = {
  action: AgentLeadOutcomeAction;
  /** Justificativa curta do agente, registrada na timeline para auditoria do operador. */
  reason: string | null;
  /** Citação literal do cliente usada pelo backend para comprovar o desfecho. */
  evidence?: string | null;
};

export type AgentTurnPlan = {
  reply: string;
  agenda: AgentAgendaPlan;
  handoff: { requested: boolean; reason: string | null };
  media: { filenames: string[] };
  leadOutcome: AgentLeadOutcome;
  externalApiLookups: AgentExternalApiLookupRequest[];
};

const LEAD_OUTCOME_ACTIONS = new Set<AgentLeadOutcomeAction>([
  "none",
  "disqualified",
  "lost_interest",
]);

const LEAD_OUTCOME_REASON_MAX = 200;

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
      handoff: {
        type: "object",
        additionalProperties: false,
        properties: {
          requested: { type: "boolean" },
          reason: { type: ["string", "null"] },
        },
        required: ["requested", "reason"],
      },
      media: {
        type: "object",
        additionalProperties: false,
        properties: {
          filenames: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
            description: "Nomes exatos do catálogo autorizado; vazio quando nenhum arquivo deve ser enviado.",
          },
        },
        required: ["filenames"],
      },
      leadOutcome: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: ["none", "disqualified", "lost_interest"],
            description:
              "Use 'none' por padrão. Só declare desfecho quando os critérios configurados neste agente forem atendidos.",
          },
          reason: {
            type: ["string", "null"],
            description:
              "Justificativa curta do desfecho, citando o critério atendido. Null quando action é 'none'.",
          },
          evidence: {
            type: ["string", "null"],
            description:
              "Trecho literal e exato dito pelo cliente que comprova o desfecho. Null quando action é 'none'. Nunca parafraseie.",
          },
        },
        required: ["action", "reason", "evidence"],
      },
      externalApiLookups: {
        type: "array", maxItems: 2,
        items: { type: "object", additionalProperties: false, properties: {
          connectorId: { type: "string" }, operationKey: { type: "string" },
          arguments: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false,
            properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] } },
        }, required: ["connectorId", "operationKey", "arguments"] },
      },
    },
    required: ["reply", "agenda", "handoff", "media", "leadOutcome", "externalApiLookups"],
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

/**
 * Lê o desfecho SEM poder de veto sobre o turno.
 *
 * Campo ausente, tipo errado ou valor desconhecido viram `none` em vez de
 * invalidar o plano inteiro. Um desvio de schema aqui deixaria o lead sem
 * resposta nenhuma (`INVALID_STRUCTURED_REPLY`) — impacto excessivo para um
 * campo cujo silêncio significa exatamente "nada a fazer".
 */
function parseLeadOutcome(value: unknown): AgentLeadOutcome {
  const none: AgentLeadOutcome = { action: "none", reason: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) return none;
  const row = value as Record<string, unknown>;
  if (
    typeof row.action !== "string" ||
    !LEAD_OUTCOME_ACTIONS.has(row.action as AgentLeadOutcomeAction)
  ) {
    return none;
  }
  const action = row.action as AgentLeadOutcomeAction;
  if (action === "none") return none;
  const reason = nullableString(row.reason);
  const evidence = nullableString(row.evidence);
  return {
    action,
    reason: reason ? reason.slice(0, LEAD_OUTCOME_REASON_MAX) : null,
    evidence: evidence ? evidence.slice(0, 500) : null,
  };
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
  const rawLookups = Array.isArray(row.externalApiLookups) ? row.externalApiLookups.slice(0, 2) : [];
  const externalApiLookups: AgentExternalApiLookupRequest[] = [];
  for (const lookup of rawLookups) {
    if (!lookup || typeof lookup !== "object" || Array.isArray(lookup)) continue;
    const item = lookup as Record<string, unknown>;
    if (typeof item.connectorId !== "string" || typeof item.operationKey !== "string" || !Array.isArray(item.arguments)) continue;
    const args = item.arguments.slice(0, 20).flatMap((argument) => {
      if (!argument || typeof argument !== "object" || Array.isArray(argument)) return [];
      const pair = argument as Record<string, unknown>;
      return typeof pair.name === "string" && ["string", "number", "boolean"].includes(typeof pair.value)
        ? [{ name: pair.name, value: pair.value as string | number | boolean }] : [];
    });
    externalApiLookups.push({ connectorId: item.connectorId, operationKey: item.operationKey, arguments: args });
  }
  const rawHandoff =
    row.handoff && typeof row.handoff === "object" && !Array.isArray(row.handoff)
      ? (row.handoff as Record<string, unknown>)
      : {};
  const rawMedia =
    row.media && typeof row.media === "object" && !Array.isArray(row.media)
      ? (row.media as Record<string, unknown>)
      : {};
  const mediaFilenames = Array.isArray(rawMedia.filenames)
    ? [...new Set(
        rawMedia.filenames
          .filter((filename): filename is string => typeof filename === "string")
          .map((filename) => filename.trim())
          .filter(Boolean),
      )].slice(0, 5)
    : [];
  return {
    reply: row.reply.trim(),
    agenda: {
      action: agenda.action as AgentAgendaPlanAction,
      date: normalizeAgentAgendaDate(agenda.date),
      time: normalizeAgentAgendaTime(agenda.time),
      location: nullableString(agenda.location),
      eventId: nullableString(agenda.eventId),
    },
    handoff: {
      requested: rawHandoff.requested === true,
      reason: rawHandoff.requested === true ? nullableString(rawHandoff.reason) : null,
    },
    media: { filenames: mediaFilenames },
    leadOutcome: parseLeadOutcome(row.leadOutcome),
    externalApiLookups,
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

export function leadOutcomeFromResult(result: AiGenerateResult): AgentLeadOutcome | null {
  if (!result.ok) return null;
  return parseAgentTurnPlan(result.structuredData)?.leadOutcome ?? null;
}
