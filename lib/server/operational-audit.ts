import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type OperationalActorType =
  | "customer" | "administrator" | "agent" | "system"
  | "webhook" | "cron" | "worker" | "external_integration";
export type OperationalAuditStatus =
  | "pending" | "running" | "completed" | "blocked" | "cancelled" | "error";
export type OperationalAuditSeverity = "debug" | "info" | "warning" | "error" | "critical";

export type OperationalAuditEventV1 = {
  operationId?: string;
  traceId?: string;
  parentSpanId?: string | null;
  tenantId?: string | null;
  actorType: OperationalActorType;
  actorId?: string | null;
  module: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  status: OperationalAuditStatus;
  severity?: OperationalAuditSeverity;
  critical?: boolean;
  channel?: string | null;
  integration?: string | null;
  durationMs?: number | null;
  attempt?: number;
  resultCode?: string | null;
  idempotencyKey?: string | null;
  relatedIds?: Record<string, string | null | undefined>;
  metadata?: Record<string, unknown>;
};

const SECRET_KEY = /(?:authorization|cookie|password|secret|token|api[-_]?key|prompt|message|content|payload|body|email|phone|whatsapp|remote[-_]?jid)/i;
const SAFE_KEY = /^[a-zA-Z0-9_.:-]{1,80}$/;
const IDENTIFIER = /^[a-z0-9_.:-]{1,120}$/;
const MAX_DEPTH = 4;
const MAX_ARRAY = 25;
const MAX_TEXT = 500;

function maskPotentialIdentifier(value: string): string {
  const compact = value.trim();
  if (compact.includes("@")) {
    const [name = "", domain = ""] = compact.split("@", 2);
    return `${name.slice(0, 2)}***@${domain.slice(0, 2)}***`;
  }
  if (/^\+?\d{8,}$/.test(compact)) {
    return `${compact.slice(0, 3)}***${compact.slice(-2)}`;
  }
  return compact.slice(0, MAX_TEXT);
}

export function sanitizeOperationalAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth >= MAX_DEPTH) return "[depth_limited]";
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return maskPotentialIdentifier(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeOperationalAuditValue(item, depth + 1));
  }
  if (typeof value !== "object") return String(value).slice(0, MAX_TEXT);

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (!SAFE_KEY.test(key)) continue;
    result[key] = SECRET_KEY.test(key)
      ? "[redacted]"
      : sanitizeOperationalAuditValue(nested, depth + 1);
  }
  return result;
}

function cleanRelatedIds(value: OperationalAuditEventV1["relatedIds"]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (!SAFE_KEY.test(key) || typeof item !== "string" || !item.trim()) continue;
    result[key] = item.trim().slice(0, 300);
  }
  return result;
}

function assertContract(event: OperationalAuditEventV1): void {
  if (!IDENTIFIER.test(event.module) || !IDENTIFIER.test(event.action)) {
    throw new Error("operational_audit_invalid_identifier");
  }
}

export async function appendOperationalAuditEvent(
  event: OperationalAuditEventV1,
  options: { strict?: boolean } = {},
): Promise<{ eventId: string; operationId: string; traceId: string; spanId: string } | null> {
  try {
    assertContract(event);
    const operationId = event.operationId ?? randomUUID();
    const relatedIds = cleanRelatedIds(event.relatedIds);
    const metadata = sanitizeOperationalAuditValue(event.metadata ?? {}) as Record<string, unknown>;
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb.rpc("append_operational_audit_event_v1", {
      p_operation_id: operationId,
      p_trace_id: event.traceId ?? null,
      p_parent_span_id: event.parentSpanId ?? null,
      p_tenant_id: event.tenantId ?? null,
      p_actor_type: event.actorType,
      p_actor_id: event.actorId?.slice(0, 300) ?? null,
      p_module: event.module,
      p_action: event.action,
      p_resource_type: event.resourceType?.slice(0, 120) ?? null,
      p_resource_id: event.resourceId?.slice(0, 300) ?? null,
      p_status: event.status,
      p_severity: event.severity ?? "info",
      p_is_critical: event.critical ?? false,
      p_channel: event.channel?.slice(0, 80) ?? null,
      p_integration: event.integration?.slice(0, 120) ?? null,
      p_duration_ms: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs ?? 0)) : null,
      p_attempt: Math.max(1, Math.round(event.attempt ?? 1)),
      p_result_code: event.resultCode?.slice(0, 160) ?? null,
      p_idempotency_key: event.idempotencyKey?.slice(0, 300) ?? null,
      p_related_ids: relatedIds,
      p_metadata: metadata,
      p_deployment_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "local").slice(0, 80),
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") throw new Error("operational_audit_insert_missing");
    const record = row as Record<string, unknown>;
    return {
      eventId: String(record.event_id), operationId: String(record.operation_id),
      traceId: String(record.trace_id), spanId: String(record.span_id),
    };
  } catch (error) {
    console.error("[operational-audit] append failed", {
      module: event.module, action: event.action,
      code: error instanceof Error ? error.message.slice(0, 160) : "unknown",
    });
    if (options.strict) throw error;
    return null;
  }
}

export function newOperationalTraceId(): string {
  return randomUUID();
}
