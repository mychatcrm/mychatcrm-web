import "server-only";

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

const ARCHIVE_BUCKET = "operational-audit-archives";
const MAX_ROWS = 100_000;
const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;

function monthBounds(monthStart: string): { start: Date; end: Date; month: string } {
  const source = new Date(`${monthStart.slice(0, 10)}T00:00:00.000Z`);
  const start = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), 1));
  const end = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 1));
  return { start, end, month: start.toISOString().slice(0, 10) };
}

function archivePath(start: Date, checksum: string): string {
  return `${start.getUTCFullYear()}/${String(start.getUTCMonth() + 1).padStart(2, "0")}/events-${checksum}.ndjson.gz`;
}

export async function archiveNextOperationalAuditMonth(): Promise<{
  status: "idle" | "archived";
  month?: string;
  rowCount?: number;
  checksum?: string;
}> {
  const sb = createSupabaseServiceClient();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const oldestAllowed = new Date();
  oldestAllowed.setUTCMonth(oldestAllowed.getUTCMonth() - 12, 1);
  oldestAllowed.setUTCHours(0, 0, 0, 0);

  const { data: oldest, error: oldestError } = await sb
    .from("operational_audit_monthly_summaries")
    .select("month_start")
    .gte("month_start", oldestAllowed.toISOString().slice(0, 10))
    .lte("month_start", cutoff.toISOString().slice(0, 10))
    .is("archived_at", null)
    .order("month_start", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (oldestError) throw new Error("audit_archive_oldest_query_failed");
  if (!oldest?.month_start) return { status: "idle" };

  const bounds = monthBounds(String(oldest.month_start));
  if (bounds.end.getTime() > cutoff.getTime()) return { status: "idle" };
  const { data: prior } = await sb
    .from("operational_audit_archives")
    .select("status,checksum_sha256,row_count")
    .eq("month_start", bounds.month)
    .maybeSingle();
  if (prior?.status === "completed") return { status: "idle" };

  await sb.from("operational_audit_archives").upsert({
    month_start: bounds.month,
    status: "processing",
    error_code: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "month_start" });

  const rows: Array<Record<string, unknown>> = [];
  try {
    for (let page = 0; page < MAX_ROWS / 1_000; page += 1) {
      const { data, error } = await sb.from("operational_audit_events")
        .select("id,occurred_at,operation_id,trace_id,span_id,parent_span_id,tenant_id,actor_type,actor_id,module,action,resource_type,resource_id,status,severity,is_critical,channel,integration,duration_ms,attempt,result_code,idempotency_key,related_ids,metadata,deployment_sha,contract_version")
        .gte("occurred_at", bounds.start.toISOString())
        .lt("occurred_at", bounds.end.toISOString())
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true })
        .range(page * 1_000, page * 1_000 + 999);
      if (error) throw new Error("audit_archive_query_failed");
      const batch = (data ?? []) as Array<Record<string, unknown>>;
      rows.push(...batch);
      if (batch.length < 1_000) break;
    }
    if (rows.length >= MAX_ROWS) throw new Error("audit_archive_row_limit_reached");

    const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");
    const compressed = gzipSync(Buffer.from(ndjson, "utf8"), { level: 9 });
    if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error("audit_archive_size_limit_reached");
    const checksum = createHash("sha256").update(compressed).digest("hex");
    const objectKey = archivePath(bounds.start, checksum);
    const { error: uploadError } = await sb.storage.from(ARCHIVE_BUCKET).upload(
      objectKey,
      compressed,
      { contentType: "application/gzip", cacheControl: "31536000", upsert: false },
    );
    if (uploadError) {
      if (!/already exists|duplicate/i.test(uploadError.message)) {
        throw new Error("audit_archive_upload_failed");
      }
      const { data: existing, error: downloadError } = await sb.storage
        .from(ARCHIVE_BUCKET)
        .download(objectKey);
      if (downloadError || !existing) throw new Error("audit_archive_existing_object_unverified");
      const existingChecksum = createHash("sha256")
        .update(Buffer.from(await existing.arrayBuffer()))
        .digest("hex");
      if (existingChecksum !== checksum) throw new Error("audit_archive_checksum_mismatch");
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(bounds.end);
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 12);
    const { error: archiveError } = await sb.from("operational_audit_archives").upsert({
      month_start: bounds.month,
      status: "completed",
      object_key: objectKey,
      checksum_sha256: checksum,
      row_count: rows.length,
      archived_at: now,
      expires_at: expiresAt.toISOString(),
      error_code: null,
      updated_at: now,
    }, { onConflict: "month_start" });
    if (archiveError) throw new Error("audit_archive_confirmation_failed");
    await sb.from("operational_audit_monthly_summaries").update({
      archived_object_key: objectKey,
      archived_checksum_sha256: checksum,
      archived_at: now,
    }).eq("month_start", bounds.month);
    await appendOperationalAuditEvent({
      actorType: "worker", actorId: "operational-audit-retention",
      module: "admin.audit", action: "archive.completed", status: "completed",
      resourceType: "operational_audit_archive", resourceId: bounds.month,
      resultCode: "audit_archive_completed",
      metadata: { rowCount: rows.length, compressedBytes: compressed.byteLength, checksum },
    });
    return { status: "archived", month: bounds.month, rowCount: rows.length, checksum };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 160) : "audit_archive_failed";
    await sb.from("operational_audit_archives").upsert({
      month_start: bounds.month, status: "failed", error_code: code, updated_at: new Date().toISOString(),
    }, { onConflict: "month_start" });
    await appendOperationalAuditEvent({
      actorType: "worker", actorId: "operational-audit-retention",
      module: "admin.audit", action: "archive.failed", status: "error", severity: "error", critical: true,
      resourceType: "operational_audit_archive", resourceId: bounds.month, resultCode: code,
    });
    throw error;
  }
}
