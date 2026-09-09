import { NextResponse } from "next/server";
import { requireLabOwner, labError, labAudit } from "@/lib/server/agent-test-lab/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { LAB_RUN_PUBLIC_COLUMNS, tickLabRun } from "@/lib/server/agent-test-lab/runs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: { id: string } };
// operational-audit: database-triggered — controls update the audited run row.
export async function GET(request: Request, { params }: Context) {
  try {
    await requireLabOwner(request); const id = assertLabUuid(params.id), sb = createSupabaseServiceClient();
    const run = await sb.from("agent_test_lab_runs").select(LAB_RUN_PUBLIC_COLUMNS).eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).single();
    if (run.error || !run.data) throw new Error("run_missing");
    const [evidence, steps, costs] = await Promise.all([
      sb.from("agent_test_lab_evidence").select("check_code,verdict,description,resource_ids,created_at").eq("run_id", id).limit(1000),
      sb.from("agent_test_lab_steps").select("ordinal,kind,status,dispatch_started_at,confirmed_at,result_code").eq("run_id", id).order("ordinal").limit(1000),
      sb.from("agent_test_lab_costs").select("category,reserved_brl,actual_brl,created_at").eq("run_id", id).limit(1000),
    ]);
    if (evidence.error || steps.error || costs.error) throw new Error("evidence_read_failed");
    await labAudit("run.read", id);
    return NextResponse.json({ run: run.data, evidence: evidence.data, steps: steps.data, costs: costs.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const owner = await requireLabOwner(request), id = assertLabUuid(params.id), body = await request.json();
    if (body.action === "refresh") {
      const row = await createSupabaseServiceClient().from("agent_test_lab_runs").select("mode")
        .eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).single();
      if (row.error || !row.data) throw new Error("run_missing");
      await tickLabRun(id, String(row.data.mode));
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!["pause", "resume", "manual", "stop"].includes(body.action)) throw new Error("invalid_action");
    await labAudit(`run.${body.action}_requested`, id);
    const result = await createSupabaseServiceClient().rpc("control_agent_test_lab_run_v1", { p_run_id: id, p_owner: owner.adminId, p_action: body.action });
    if (result.error) throw new Error("run_control_failed");
    return NextResponse.json({ ok: true, ...result.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
