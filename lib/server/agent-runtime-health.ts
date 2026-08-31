import "server-only";

import { timingSafeEqual } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export type AgentRuntimeHealthPayload = {
  version: number;
  generatedAt: string | null;
  status: "healthy" | "unhealthy";
  reasons: string[];
  heartbeat: {
    monitorObservedAt: string | null;
    monitorAgeSeconds: number | null;
    monitorStatus: string;
  };
  schedulers: {
    staleCount: number;
    failuresLast5Minutes: number;
    agendaReminderLastDispatchAt: string | null;
    evolutionInboxLastDispatchAt: string | null;
    followUpLastDispatchAt: string | null;
  };
  queues: {
    agentResponse: { overdue: number; expiredClaims: number };
    evolutionInbox: { overdue: number; expiredClaims: number };
    followUp: { overdue: number; expiredClaims: number };
    agendaReminder: { overdue: number; expiredClaims: number };
    outbox: { overdue: number; expiredClaims: number };
    terminalFailuresSinceActivation: number;
  };
  alerts: { criticalOpen: number; warningOpen: number };
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function queueStats(value: unknown): { overdue: number; expiredClaims: number } {
  const record = asRecord(value);
  return {
    overdue: finiteNonNegative(record.overdue),
    expiredClaims: finiteNonNegative(record.expiredClaims),
  };
}

/** Keep the external health contract deliberately small and free of row data. */
export function sanitizeAgentRuntimeHealth(value: unknown): AgentRuntimeHealthPayload {
  const root = asRecord(value);
  const heartbeat = asRecord(root.heartbeat);
  const schedulers = asRecord(root.schedulers);
  const queues = asRecord(root.queues);
  const alerts = asRecord(root.alerts);
  const reasons = Array.isArray(root.reasons)
    ? root.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 20)
    : ["health_contract_invalid"];
  const status = root.status === "healthy" && reasons.length === 0
    ? "healthy"
    : "unhealthy";

  return {
    version: finiteNonNegative(root.version) || 1,
    generatedAt: nullableText(root.generatedAt),
    status,
    reasons,
    heartbeat: {
      monitorObservedAt: nullableText(heartbeat.monitorObservedAt),
      monitorAgeSeconds: typeof heartbeat.monitorAgeSeconds === "number"
        ? finiteNonNegative(heartbeat.monitorAgeSeconds)
        : null,
      monitorStatus: nullableText(heartbeat.monitorStatus) ?? "missing",
    },
    schedulers: {
      staleCount: finiteNonNegative(schedulers.staleCount),
      failuresLast5Minutes: finiteNonNegative(schedulers.failuresLast5Minutes),
      agendaReminderLastDispatchAt: nullableText(schedulers.agendaReminderLastDispatchAt),
      evolutionInboxLastDispatchAt: nullableText(schedulers.evolutionInboxLastDispatchAt),
      followUpLastDispatchAt: nullableText(schedulers.followUpLastDispatchAt),
    },
    queues: {
      agentResponse: queueStats(queues.agentResponse),
      evolutionInbox: queueStats(queues.evolutionInbox),
      followUp: queueStats(queues.followUp),
      agendaReminder: queueStats(queues.agendaReminder),
      outbox: queueStats(queues.outbox),
      terminalFailuresSinceActivation: finiteNonNegative(queues.terminalFailuresSinceActivation),
    },
    alerts: {
      criticalOpen: finiteNonNegative(alerts.criticalOpen),
      warningOpen: finiteNonNegative(alerts.warningOpen),
    },
  };
}

function safeEquals(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function isAuthorizedAgentRuntimeHealthRequest(request: Request): boolean {
  const configured = [
    process.env.AGENT_RUNTIME_WATCHDOG_SECRET?.trim(),
    process.env.INTERNAL_API_TOKEN?.trim(),
  ].filter((value): value is string => Boolean(value));
  if (configured.length === 0) return false;

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const candidates = [
    bearer,
    request.headers.get("x-agent-runtime-watchdog-secret")?.trim() ?? "",
  ].filter(Boolean);

  return candidates.some((candidate) => configured.some((secret) => safeEquals(candidate, secret)));
}
