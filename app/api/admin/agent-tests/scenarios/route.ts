import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireLabOwner, labError, labAudit } from "@/lib/server/agent-test-lab/auth";
import { parseLabScenario } from "@/lib/agent-test-lab/contracts";
import { LAB_OWNER_ID } from "@/lib/agent-test-lab/policy";

export const dynamic = "force-dynamic";

/** Saved scripts, so a scenario can be repeated under a new run id. */
export async function GET(request: Request) {
  try {
    await requireLabOwner(request);
    const rows = await createSupabaseServiceClient().from("agent_test_lab_scenarios")
      .select("id,name,version,definition,created_at")
      .eq("owner_admin_id", LAB_OWNER_ID).is("archived_at", null)
      .order("created_at", { ascending: false }).limit(200);
    if (rows.error) throw new Error("scenarios_read_failed");
    return NextResponse.json({ scenarios: rows.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}

/** Saving bumps the version instead of overwriting: an old result keeps its script. */
export async function POST(request: Request) {
  try {
    await requireLabOwner(request);
    const scenario = parseLabScenario((await request.json()).scenario);
    const sb = createSupabaseServiceClient();
    const previous = await sb.from("agent_test_lab_scenarios").select("version")
      .eq("owner_admin_id", LAB_OWNER_ID).eq("name", scenario.name).is("archived_at", null)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    if (previous.error) throw new Error("scenarios_read_failed");
    const version = Number(previous.data?.version ?? 0) + 1;
    const saved = await sb.from("agent_test_lab_scenarios").insert({
      owner_admin_id: LAB_OWNER_ID, name: scenario.name, version, definition: scenario,
    }).select("id,name,version").single();
    if (saved.error || !saved.data) throw new Error("scenario_save_failed");
    await labAudit("scenario.saved", String(saved.data.id));
    return NextResponse.json({ ok: true, scenario: saved.data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
