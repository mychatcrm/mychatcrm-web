import { waitUntil } from "@vercel/functions";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, isOperationalAuditOwner } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { processOperationalAuditExport } from "@/lib/server/operational-audit-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const FORMATS = new Set(["csv", "json", "ndjson"]);

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!isOperationalAuditOwner(session)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const format = typeof body.format === "string" && FORMATS.has(body.format) ? body.format : null;
  const from = new Date(body.from);
  const to = new Date(body.to);
  if (!format || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())
    || to <= from || to.getTime() - from.getTime() > 31 * 24 * 60 * 60_000) {
    return NextResponse.json({ error: "Período ou formato inválido. O limite é de 31 dias." }, { status: 400 });
  }
  const allowed = ["tenant_id", "actor_id", "module", "action", "resource_type", "resource_id", "status", "severity", "actor_type", "channel", "integration", "trace_id", "operation_id", "critical"];
  const filters: Record<string, string | boolean> = {};
  for (const key of allowed) {
    const value = body.filters?.[key];
    if (typeof value === "boolean") filters[key] = value;
    if (typeof value === "string" && /^[a-zA-Z0-9_.:@+-]{1,160}$/.test(value)) filters[key] = value;
  }
  const sb = createSupabaseServiceClient();
  const operationId = randomUUID();
  const { data, error } = await sb.from("operational_audit_exports").insert({
    operation_id: operationId,
    requested_by_admin_id: session.adminId, format, filters,
    range_start: from.toISOString(), range_end: to.toISOString(),
  }).select("id,status,format,created_at").single();
  if (error || !data) return NextResponse.json({ error: "Não foi possível criar a exportação." }, { status: 500 });
  try {
    await appendOperationalAuditEvent({
      operationId,
      actorType: "administrator", actorId: session.adminId,
      module: "admin.audit", action: "export.requested", status: "pending",
      severity: "info", critical: true, resourceType: "operational_audit_export", resourceId: data.id,
      resultCode: "audit_export_queued", relatedIds: { audit_export_id: data.id },
      metadata: { format, from: from.toISOString(), to: to.toISOString() },
    }, { strict: true });
  } catch {
    await sb.from("operational_audit_exports").update({ status: "failed", error_code: "audit_required" }).eq("id", data.id);
    return NextResponse.json({ error: "A exportação foi bloqueada porque não pôde ser auditada." }, { status: 503 });
  }
  waitUntil(processOperationalAuditExport(data.id));
  return NextResponse.json({ export: data }, { status: 202 });
}
