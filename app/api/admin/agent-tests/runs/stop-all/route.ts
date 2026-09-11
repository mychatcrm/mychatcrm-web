import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireLabOwner, labError, labAudit } from "@/lib/server/agent-test-lab/auth";

export const dynamic = "force-dynamic";

/**
 * Stops every open run at once. Messages already delivered and appointments already
 * confirmed are not undone here — stopping blocks future tester actions only.
 */
export async function POST(request: Request) {
  try {
    const owner = await requireLabOwner(request);
    await labAudit("run.stop_all_requested");
    const result = await createSupabaseServiceClient().rpc("stop_all_agent_test_lab_runs_v1", { p_owner: owner.adminId });
    if (result.error) throw new Error("stop_all_failed");
    return NextResponse.json({ ok: true, stopped: result.data ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
