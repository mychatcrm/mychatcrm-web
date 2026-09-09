import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { jidToDigits } from "@/lib/integrations/evolution-api";
import { LAB_OWNER_ID } from "@/lib/agent-test-lab/policy";
import { LAB_EMPTY_EFFECTS, type LabObservedEffects } from "@/lib/agent-test-lab/effect-policy";

type Counted = { count: number | null };
const total = (result: Counted & { error: unknown }) => {
  if (result.error) throw new Error("effect_read_failed");
  return result.count ?? 0;
};

/**
 * Reads what the run actually caused, from the tables that hold the truth.
 *
 * Everything is scoped to the tested tenant, to the tester's own number and to the
 * window that starts when the run started. A row that already existed, or that
 * belongs to somebody else's conversation, can never be counted as this test's
 * doing — which is also what keeps the cleanup honest later.
 */
export async function observeLabEffects(runId: string): Promise<{ observed: LabObservedEffects; resources: { type: string; table: string; id: string }[] }> {
  const sb = createSupabaseServiceClient();
  const run = await sb.from("agent_test_lab_runs")
    .select("id,target_tenant_id,target_agent_id,sender_connection_id,created_at,finished_at")
    .eq("id", runId).eq("owner_admin_id", LAB_OWNER_ID).single();
  if (run.error || !run.data) throw new Error("run_read_failed");
  const tenantId = run.data.target_tenant_id ? String(run.data.target_tenant_id) : null;
  if (!tenantId || !run.data.sender_connection_id) return { observed: { ...LAB_EMPTY_EFFECTS }, resources: [] };

  const sender = await sb.from("agent_test_lab_connections").select("wa_jid").eq("id", run.data.sender_connection_id).maybeSingle();
  if (sender.error) throw new Error("sender_read_failed");
  const testerJid = sender.data?.wa_jid ? String(sender.data.wa_jid) : null;
  if (!testerJid) return { observed: { ...LAB_EMPTY_EFFECTS }, resources: [] };
  const testerDigits = jidToDigits(testerJid);
  const since = String(run.data.created_at);
  const resources: { type: string; table: string; id: string }[] = [];

  // The lead the agent created for the tester's number, if any.
  const lead = await sb.from("leads").select("id,created_at").eq("tenant_id", tenantId)
    .eq("phone", testerDigits).gte("created_at", since).maybeSingle();
  if (lead.error) throw new Error("effect_read_failed");
  if (lead.data) resources.push({ type: "lead", table: "leads", id: String(lead.data.id) });

  // Appointments are matched through that lead: a lead-less appointment in the
  // window belongs to somebody else and must not be attributed here.
  let agendaCreated = 0, agendaCancelled = 0;
  if (lead.data) {
    const created = await sb.from("agenda_events").select("id,status", { count: "exact" })
      .eq("tenant_id", tenantId).eq("lead_id", lead.data.id).gte("created_at", since);
    if (created.error) throw new Error("effect_read_failed");
    for (const row of created.data ?? []) resources.push({ type: "agenda_event", table: "agenda_events", id: String(row.id) });
    agendaCreated = (created.data ?? []).filter(row => String(row.status) !== "cancelled").length;
    agendaCancelled = (created.data ?? []).filter(row => String(row.status) === "cancelled").length;
  }

  const [followUps, reminders, outbound] = await Promise.all([
    sb.from("follow_up_jobs").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("remote_jid", testerJid).gte("created_at", since),
    sb.from("agenda_reminder_jobs_v2").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("remote_jid", testerJid).gte("created_at", since),
    sb.from("agent_outbound_outbox").select("id,provider_message_id,status")
      .eq("tenant_id", tenantId).eq("remote_jid", testerJid).gte("created_at", since).limit(500),
  ]);
  if (outbound.error) throw new Error("effect_read_failed");

  const observed: LabObservedEffects = {
    leadCreated: Boolean(lead.data), agendaCreated, agendaCancelled,
    followUpScheduled: total(followUps), reminderScheduled: total(reminders),
    // A row in the outbox is an intent. Only a provider id makes it a delivery.
    outboundConfirmed: (outbound.data ?? []).filter(row => Boolean(row.provider_message_id)).length,
    outboundUnconfirmed: (outbound.data ?? []).filter(row => !row.provider_message_id).length,
  };
  return { observed, resources };
}

/** Persists what was observed, so the report and the cleanup share one source. */
export async function recordLabEffects(runId: string): Promise<LabObservedEffects> {
  const sb = createSupabaseServiceClient();
  const { observed, resources } = await observeLabEffects(runId);
  const run = await sb.from("agent_test_lab_runs").select("target_tenant_id").eq("id", runId).single();
  if (run.error) throw new Error("run_read_failed");

  for (const resource of resources) {
    await sb.from("agent_test_lab_resources").upsert({
      run_id: runId, tenant_id: String(run.data.target_tenant_id ?? ""), resource_type: resource.type,
      resource_id: resource.id, cleanup_status: "not_requested",
    }, { onConflict: "tenant_id,resource_type,resource_id", ignoreDuplicates: true });
  }
  for (const [effect, value] of Object.entries(observed)) {
    if (value === false || value === 0) continue;
    await sb.from("agent_test_lab_effects").upsert({
      run_id: runId, effect_type: effect, resource_table: "observed", resource_id: "run",
      details: { value },
    }, { onConflict: "run_id,effect_type,resource_table,resource_id" });
  }
  return observed;
}
