import { NextResponse } from "next/server";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { inspectLabSender } from "@/lib/server/agent-test-lab/connections";
import { listLabRuns, LAB_ENABLED_INTERACTIVE_MODES } from "@/lib/server/agent-test-lab/runs";
import { labMaskedJid, labPhoneJid, isLabInternalMode } from "@/lib/agent-test-lab/policy";
import { LAB_MODES } from "@/lib/agent-test-lab/contracts";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireLabOwner(request); const sb = createSupabaseServiceClient();
    const tenantId = new URL(request.url).searchParams.get("tenantId");
    const [tenants, sender, runs] = await Promise.all([
      sb.from("tenants").select("id,name,status").order("name").limit(1000), inspectLabSender(), listLabRuns(),
    ]);
    if (tenants.error) throw new Error("tenants_read_failed");
    let agents: unknown[] = [], connections: unknown[] = [], rules: unknown[] = [];
    if (tenantId) {
      const [a,e,c,r] = await Promise.all([
        sb.from("tenant_agents").select("agent_id,display_name,active,config_version").eq("tenant_id", tenantId).is("archived_at", null).limit(1000),
        sb.from("tenant_evolution_instances").select("id,wa_jid,connection_state,slot_index").eq("tenant_id", tenantId).limit(100),
        sb.from("whatsapp_cloud_connections").select("id,display_phone,active,slot_index").eq("tenant_id", tenantId).limit(100),
        sb.from("lead_distribution_rules").select("id,name,source,active,agent_ids,connection_id,transport,included_form_ids,use_all_forms").eq("tenant_id", tenantId).limit(1000),
      ]);
      if (a.error || e.error || c.error || r.error) throw new Error("targets_read_failed");
      agents = a.data ?? []; rules = r.data ?? [];
      connections = [...(e.data ?? []).map(row => ({ id: row.id, channel: "evolution", slot: row.slot_index, state: row.connection_state, number: labMaskedJid(labPhoneJid(row.wa_jid)) })),
        ...(c.data ?? []).map(row => ({ id: row.id, channel: "meta_cloud", slot: row.slot_index, state: row.active ? "open" : "close", number: labMaskedJid(labPhoneJid(row.display_phone)) }))];
    }
    return NextResponse.json({ version: 1, sha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.AGENT_TEST_LAB_DEPLOY_SHA ?? "local",
      sender, runs, tenants: tenants.data, agents, connections, rules,
      capabilities: {
        internal: Boolean(process.env.AGENT_TEST_LAB_GITHUB_TOKEN),
        // Only the modes with a working executor are offered. The rest stay blocked
        // in the backend too, so an enabled button always means a working feature.
        modes: Object.fromEntries(LAB_MODES.map(mode => [mode, isLabInternalMode(mode)
          ? Boolean(process.env.AGENT_TEST_LAB_GITHUB_TOKEN)
          : LAB_ENABLED_INTERACTIVE_MODES.has(mode)])),
        realReason: "real_test_dependencies_pending",
      } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
