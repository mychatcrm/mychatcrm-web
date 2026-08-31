import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, isOperationalAuditOwner } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENUM_FILTERS = {
  status: new Set(["pending", "running", "completed", "blocked", "cancelled", "error"]),
  severity: new Set(["debug", "info", "warning", "error", "critical"]),
  actorType: new Set(["customer", "administrator", "agent", "system", "webhook", "cron", "worker", "external_integration"]),
} as const;

function isoParam(value: string | null, fallback: Date): string {
  if (!value) return fallback.toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function safeText(value: string | null, max = 160): string | null {
  if (!value) return null;
  const clean = value.trim();
  return clean && /^[a-zA-Z0-9_.:@+-]+$/.test(clean) ? clean.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!isOperationalAuditOwner(session)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const now = new Date();
  const from = isoParam(url.searchParams.get("from"), new Date(now.getTime() - 24 * 60 * 60_000));
  const to = isoParam(url.searchParams.get("to"), now);
  const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 50)));
  const sb = createSupabaseServiceClient();
  let query = sb
    .from("operational_audit_events")
    .select("id,operation_id,trace_id,span_id,parent_span_id,occurred_at,tenant_id,actor_type,actor_id,module,action,resource_type,resource_id,status,severity,is_critical,channel,integration,duration_ms,attempt,result_code,idempotency_key,related_ids,metadata,deployment_sha")
    .gte("occurred_at", from)
    .lt("occurred_at", to)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  for (const key of ["tenant_id", "actor_id", "module", "action", "resource_type", "resource_id", "channel", "integration", "trace_id", "operation_id"] as const) {
    const value = safeText(url.searchParams.get(key));
    if (value) query = query.eq(key, value);
  }
  const status = url.searchParams.get("status");
  if (status && ENUM_FILTERS.status.has(status)) query = query.eq("status", status);
  const severity = url.searchParams.get("severity");
  if (severity && ENUM_FILTERS.severity.has(severity)) query = query.eq("severity", severity);
  const actorType = url.searchParams.get("actor_type");
  if (actorType && ENUM_FILTERS.actorType.has(actorType)) query = query.eq("actor_type", actorType);
  if (url.searchParams.get("critical") === "true") query = query.eq("is_critical", true);
  if (url.searchParams.get("slow") === "true") query = query.gte("duration_ms", 2_000);
  if (url.searchParams.get("running") === "true") query = query.in("status", ["pending", "running"]);
  const cursorAt = isoParam(url.searchParams.get("cursor_at"), now);
  const cursorId = safeText(url.searchParams.get("cursor_id"));
  if (cursorId && url.searchParams.has("cursor_at")) {
    query = query.or(`occurred_at.lt.${cursorAt},and(occurred_at.eq.${cursorAt},id.lt.${cursorId})`);
  }

  const startedAt = Date.now();
  const [{ data, error }, { data: dashboard, error: dashboardError }] = await Promise.all([
    query,
    sb.rpc("get_operational_audit_dashboard_v1", { p_from: from, p_to: to }),
  ]);
  if (error || dashboardError) {
    return NextResponse.json({ error: "Falha ao consultar a auditoria." }, { status: 500 });
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  const last = events.at(-1);

  void appendOperationalAuditEvent({
    actorType: "administrator", actorId: session.adminId,
    module: "admin.audit", action: "audit.read", status: "completed",
    resourceType: "operational_audit_events", durationMs: Date.now() - startedAt,
    resultCode: "audit_query_completed", metadata: { filtersApplied: [...url.searchParams.keys()].length },
  });

  return NextResponse.json({
    dashboard: dashboard ?? {}, events,
    nextCursor: hasMore && last ? { occurredAt: last.occurred_at, id: last.id } : null,
    range: { from, to },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
