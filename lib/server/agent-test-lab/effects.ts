import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_OWNER_ID } from "@/lib/agent-test-lab/policy";
import { LAB_EMPTY_EFFECTS, type LabObservedEffects } from "@/lib/agent-test-lab/effect-policy";

/** Exact journey + immutable tester identity + closed observation window. */
export async function observeLabEffects(runId: string): Promise<{ observed: LabObservedEffects; resources: { type: string; table: string; id: string }[] }> {
  const sb = createSupabaseServiceClient();
  const bound = await sb.rpc("bind_agent_test_lab_journey_v2", { p_run_id: runId });
  if (bound.error) throw new Error("effect_scope_unconfirmed");
  const run = await sb.from("agent_test_lab_runs")
    .select("id,target_tenant_id,target_agent_id,target_rule_id,target_channel,target_connection_id,tester_jid,bound_journey_id,created_at,finished_at")
    .eq("id", runId).eq("owner_admin_id", LAB_OWNER_ID).single();
  if (run.error || !run.data) throw new Error("run_read_failed");
  const r = run.data;
  if (!r.bound_journey_id || !r.tester_jid) return { observed: { ...LAB_EMPTY_EFFECTS }, resources: [] };
  const since = String(r.created_at), until = r.finished_at ? String(r.finished_at) : new Date().toISOString();
  const [followUps, reminders, outbound] = await Promise.all([
    sb.from("follow_up_jobs").select("id,status")
      .eq("tenant_id", r.target_tenant_id).eq("agent_id", r.target_agent_id).eq("journey_id", r.bound_journey_id)
      .eq("remote_jid", r.tester_jid).eq("channel", r.target_channel).eq("connection_id", r.target_connection_id)
      .eq("rule_id", r.target_rule_id).gte("created_at", since).lte("created_at", until).limit(501),
    sb.from("agenda_reminder_jobs_v2").select("id,status,outbox_id,provider_message_id,sent_at")
      .eq("tenant_id", r.target_tenant_id).eq("agent_id", r.target_agent_id).eq("journey_id", r.bound_journey_id)
      .eq("remote_jid", r.tester_jid).eq("channel", r.target_channel).eq("connection_id", r.target_connection_id)
      .eq("rule_id", r.target_rule_id).gte("created_at", since).lte("created_at", until).limit(501),
    sb.from("agent_outbound_outbox").select("id,operation_key,provider_message_id,status,delivered_at,authorization_status")
      .eq("tenant_id", r.target_tenant_id).eq("agent_id", r.target_agent_id).eq("journey_id", r.bound_journey_id)
      .eq("remote_jid", r.tester_jid).eq("channel", r.target_channel).eq("connection_id", r.target_connection_id)
      .eq("rule_id", r.target_rule_id).gte("created_at", since).lte("created_at", until).limit(501),
  ]);
  if (followUps.error || reminders.error || outbound.error) throw new Error("effect_read_failed");
  if ([followUps.data, reminders.data, outbound.data].some(rows => (rows?.length ?? 0) > 500)) throw new Error("effect_window_limit");
  const confirmed = (outbound.data ?? []).filter(row => row.provider_message_id && row.delivered_at && Date.parse(row.delivered_at) <= Date.parse(until) && row.authorization_status === "authorized");
  const confirmedIds = new Set(confirmed.map(row => String(row.id)));
  const followUpIds = new Set((followUps.data ?? []).map(row => String(row.id)));
  // Phone/time alone cannot establish resource ownership for destructive cleanup.
  return { resources: [], observed: {
    ...LAB_EMPTY_EFFECTS, scopeConfirmed: true,
    followUpScheduled: (followUps.data ?? []).filter(row => ["pending", "processing"].includes(row.status)).length,
    reminderScheduled: (reminders.data ?? []).filter(row => ["pending", "processing"].includes(row.status)).length,
    followUpDelivered: confirmed.filter(row => {
      const match = /^follow-up:([a-f0-9-]{36}):\d+$/.exec(String(row.operation_key));
      return match && followUpIds.has(match[1]);
    }).length,
    reminderDelivered: (reminders.data ?? []).filter(row => row.sent_at && row.provider_message_id && confirmedIds.has(String(row.outbox_id))).length,
    outboundConfirmed: confirmed.length,
    outboundUnconfirmed: (outbound.data ?? []).filter(row => !confirmedIds.has(String(row.id)) && !["cancelled", "blocked"].includes(row.status)).length,
  } };
}

export async function recordLabEffects(runId: string): Promise<LabObservedEffects> {
  const sb = createSupabaseServiceClient();
  const { observed } = await observeLabEffects(runId);
  for (const [effect, value] of Object.entries(observed)) {
    const saved = await sb.from("agent_test_lab_effects").upsert({
      run_id: runId, effect_type: effect, resource_table: "observed", resource_id: "run", details: { value },
    }, { onConflict: "run_id,effect_type,resource_table,resource_id" });
    if (saved.error) throw new Error("effect_save_failed");
  }
  return observed;
}
