import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { purgeLabExpiredAssets } from "@/lib/server/agent-test-lab/assets-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = POST;

/**
 * Laboratory conversations and files are kept for 30 days, sanitized results for 90.
 * Operational audit events are written elsewhere and are never removed here, so a
 * purged run still leaves its trail behind.
 */
export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const started = Date.now();
  try {
    await purgeLabExpiredAssets();
    const result = await createSupabaseServiceClient().rpc("purge_agent_test_lab_content_v1");
    if (result.error) throw new Error("lab_retention_failed");
    await appendOperationalAuditEvent({ actorType: "cron", module: "agent.test_lab", action: "retention.purged",
      status: "completed", durationMs: Date.now() - started, metadata: result.data ?? {} });
    return NextResponse.json({ ok: true, ...(result.data ?? {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await appendOperationalAuditEvent({ actorType: "cron", module: "agent.test_lab", action: "retention.purged",
      status: "error", severity: "error", resultCode: "lab_retention_failed", durationMs: Date.now() - started });
    return NextResponse.json({ ok: false, code: "lab_retention_failed" }, { status: 503 });
  }
}
