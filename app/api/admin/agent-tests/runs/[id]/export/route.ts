import { NextResponse } from "next/server";
import { requireLabOwner, labError, labAudit } from "@/lib/server/agent-test-lab/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { LAB_RUN_PUBLIC_COLUMNS } from "@/lib/server/agent-test-lab/runs";
export const dynamic = "force-dynamic";
/** Explicitly opt in to content; credentials and prompts are never exported. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireLabOwner(request); const id = assertLabUuid(params.id), sb = createSupabaseServiceClient();
    const query = new URL(request.url).searchParams, format = query.get("format") ?? "json", includeContent = query.get("includeContent") === "true";
    if (!["json", "csv"].includes(format)) throw new Error("invalid_export_format");
    const run = await sb.from("agent_test_lab_runs").select(LAB_RUN_PUBLIC_COLUMNS).eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).single();
    if (run.error || !run.data) throw new Error("run_missing");
    const evidence = await sb.from("agent_test_lab_evidence").select("check_code,verdict,description,resource_ids,created_at").eq("run_id", id).limit(1000);
    if (evidence.error) throw new Error("export_read_failed");
    let messages: unknown[] | undefined;
    if (includeContent) {
      const result = await sb.from("agent_test_lab_messages").select("direction,kind,content,provider_occurred_at,received_at").eq("run_id", id).order("received_at").limit(3000);
      if (result.error) throw new Error("export_read_failed");
      messages = result.data ?? [];
    }
    await labAudit(includeContent ? "run.content_exported" : "run.exported", id);
    const data = { version: 1, exportedAt: new Date().toISOString(), run: run.data, evidence: evidence.data, ...(messages ? { messages } : {}) };
    const headers = { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="mychatcrm-teste-${id}.${format}"`, "X-Content-Type-Options": "nosniff" };
    if (format === "json") return new NextResponse(JSON.stringify(data, null, 2), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
    const cell = (value: unknown) => {
      const text = String(value ?? "");
      // Prevent spreadsheet formula injection when importing an exported report.
      return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
    };
    const rows = [["runId", "SHA", "check", "verdict", "description"], ...(evidence.data ?? []).map(e => [id, run.data.deployed_sha, e.check_code, e.verdict, e.description])];
    return new NextResponse("\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n"), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  } catch (error) { return labError(error); }
}
