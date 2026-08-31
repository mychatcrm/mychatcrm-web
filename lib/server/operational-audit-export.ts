import "server-only";

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

type ExportFormat = "csv" | "json" | "ndjson";

function csvCell(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function serialize(rows: Array<Record<string, unknown>>, format: ExportFormat): Buffer {
  if (format === "json") return Buffer.from(JSON.stringify(rows), "utf8");
  if (format === "ndjson") return Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  const fields = [
    "id", "occurred_at", "operation_id", "trace_id", "tenant_id", "actor_type", "actor_id",
    "module", "action", "resource_type", "resource_id", "status", "severity", "is_critical",
    "channel", "integration", "duration_ms", "attempt", "result_code", "deployment_sha",
  ];
  return Buffer.from([
    fields.join(","),
    ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")),
  ].join("\n"), "utf8");
}

export async function processOperationalAuditExport(exportId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { data: job, error: jobError } = await sb
    .from("operational_audit_exports")
    .update({ status: "processing", started_at: new Date().toISOString(), error_code: null })
    .eq("id", exportId).eq("status", "pending")
    .select("id,operation_id,requested_by_admin_id,format,filters,range_start,range_end")
    .maybeSingle();
  if (jobError || !job) return;

  try {
    const rows: Array<Record<string, unknown>> = [];
    const filters = (job.filters ?? {}) as Record<string, unknown>;
    for (let page = 0; page < 50; page += 1) {
      let query = sb.from("operational_audit_events")
        .select("id,occurred_at,operation_id,trace_id,tenant_id,actor_type,actor_id,module,action,resource_type,resource_id,status,severity,is_critical,channel,integration,duration_ms,attempt,result_code,related_ids,metadata,deployment_sha")
        .gte("occurred_at", job.range_start).lt("occurred_at", job.range_end)
        .order("occurred_at", { ascending: true }).range(page * 1_000, page * 1_000 + 999);
      for (const key of ["tenant_id", "actor_id", "module", "action", "resource_type", "resource_id", "status", "severity", "actor_type", "channel", "integration", "trace_id", "operation_id"] as const) {
        const value = filters[key];
        if (typeof value === "string" && value) query = query.eq(key, value);
      }
      if (filters.critical === true) query = query.eq("is_critical", true);
      const { data, error } = await query;
      if (error) throw new Error("audit_export_query_failed");
      const batch = (data ?? []) as Array<Record<string, unknown>>;
      rows.push(...batch);
      if (batch.length < 1_000) break;
    }

    const format = job.format as ExportFormat;
    const compressed = gzipSync(serialize(rows, format), { level: 9 });
    if (compressed.byteLength > 25 * 1024 * 1024) throw new Error("audit_export_too_large");
    const checksum = createHash("sha256").update(compressed).digest("hex");
    const extension = format === "ndjson" ? "ndjson" : format;
    await sb.from("operational_audit_exports").update({
      status: "completed", row_count: rows.length,
      filename: `mychatcrm-auditoria-${job.id}.${extension}.gz`,
      content_type: "application/gzip", payload: `\\x${compressed.toString("hex")}`,
      checksum_sha256: checksum, completed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    }).eq("id", job.id);
    await appendOperationalAuditEvent({
      operationId: job.operation_id,
      actorType: "worker", actorId: "operational-audit-export",
      module: "admin.audit", action: "export.completed", status: "completed",
      resourceType: "operational_audit_export", resourceId: job.id,
      resultCode: "audit_export_completed", metadata: { format, rowCount: rows.length },
      relatedIds: { audit_export_id: job.id },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 160) : "audit_export_failed";
    await sb.from("operational_audit_exports").update({ status: "failed", error_code: code, completed_at: new Date().toISOString() }).eq("id", job.id);
    await appendOperationalAuditEvent({
      operationId: job.operation_id,
      actorType: "worker", actorId: "operational-audit-export",
      module: "admin.audit", action: "export.failed", status: "error", severity: "error",
      resourceType: "operational_audit_export", resourceId: job.id,
      resultCode: code, relatedIds: { audit_export_id: job.id },
    });
  }
}
