import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_OWNER_ID, assertLabUuid, isLabInternalMode } from "@/lib/agent-test-lab/policy";
import { LAB_TICK_INTERVAL_SECONDS, type LabStepV1 } from "@/lib/agent-test-lab/contracts";
import { labAgentTurnState, labStepVerdict } from "@/lib/agent-test-lab/turn-policy";
import { dispatchLabText } from "./sender";

type StepRow = {
  id: string; ordinal: number; kind: string; status: string; command: Record<string, unknown>;
  idempotency_key: string; dispatch_started_at: string | null; confirmed_at: string | null; result_code: string | null;
};

async function finish(sb: ReturnType<typeof createSupabaseServiceClient>, runId: string, claim: string, values: Record<string, unknown>) {
  const saved = await sb.from("agent_test_lab_runs")
    .update({ ...values, updated_at: new Date().toISOString(), claim_token: null, claim_expires_at: null })
    .eq("id", runId).eq("claim_token", claim);
  if (saved.error) throw new Error("run_update_failed");
}

/**
 * Advances one interactive run by at most one provider call. The browser may be
 * closed at any point: every decision is read from and written to the database.
 */
export async function tickInteractiveLabRun(id: string): Promise<void> {
  assertLabUuid(id);
  const sb = createSupabaseServiceClient();
  const claim = await sb.rpc("claim_agent_test_lab_run_v1", { p_run_id: id });
  if (claim.error) throw new Error("run_claim_failed");
  if (!claim.data?.claimToken) return;
  const claimToken = String(claim.data.claimToken);
  const now = Date.now();

  const loaded = await sb.from("agent_test_lab_runs").select("*").eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).single();
  if (loaded.error || !loaded.data) throw new Error("run_read_failed");
  const run = loaded.data;
  if (isLabInternalMode(run.mode)) throw new Error("interactive_worker_mode_rejected");

  const owner = await sb.from("admin_users").select("id").eq("id", LAB_OWNER_ID).eq("active", true).eq("role", "super_admin").maybeSingle();
  if (owner.error || !owner.data) {
    await finish(sb, id, claimToken, { status: "cancelled", verdict: "inconclusive", result_code: "owner_inactive", finished_at: new Date().toISOString() });
    return;
  }

  const stepsResult = await sb.from("agent_test_lab_steps").select("*").eq("run_id", id).order("ordinal").limit(1000);
  if (stepsResult.error) throw new Error("steps_read_failed");
  const steps = (stepsResult.data ?? []) as StepRow[];

  if (run.status === "stopping") {
    const pending = steps.some(step => step.dispatch_started_at && !step.confirmed_at);
    await finish(sb, id, claimToken, {
      status: "cancelled", verdict: pending ? "inconclusive" : run.verdict ?? "not_executed",
      result_code: run.result_code ?? "stopped_by_owner", finished_at: new Date().toISOString(),
    });
    return;
  }

  // An unconfirmed dispatch is evidence to inspect, never a licence to send again.
  const unconfirmed = steps.find(step => step.dispatch_started_at && !step.confirmed_at);
  if (unconfirmed) {
    await finish(sb, id, claimToken, {
      status: "stopping", verdict: "inconclusive", result_code: "provider_receipt_unknown",
      next_step_at: new Date(now + 1000).toISOString(),
    });
    return;
  }

  const pending = steps.find(step => !step.dispatch_started_at);
  if (pending) {
    const armed = await sb.rpc("arm_agent_test_lab_step_v1", { p_run_id: id, p_step_id: pending.id, p_claim: claimToken });
    if (armed.error || armed.data !== true) {
      await finish(sb, id, claimToken, { result_code: "step_arm_rejected", next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString() });
      return;
    }
    const text = typeof pending.command.text === "string" ? pending.command.text : "";
    const dispatch = await dispatchLabText({
      tenantId: String(run.target_tenant_id), connectionId: String(run.target_connection_id),
      channel: String(run.target_channel), targetJid: String(run.target_jid), text,
    });

    if (dispatch.outcome === "rejected") {
      await sb.from("agent_test_lab_steps").update({ status: "rejected", result_code: dispatch.code, confirmed_at: new Date().toISOString() }).eq("id", pending.id);
      await finish(sb, id, claimToken, { status: "stopping", verdict: "failed", result_code: dispatch.code, next_step_at: new Date(now + 1000).toISOString() });
      return;
    }
    if (dispatch.outcome === "inconclusive") {
      await sb.from("agent_test_lab_steps").update({ status: "unconfirmed", result_code: dispatch.code }).eq("id", pending.id);
      await finish(sb, id, claimToken, { status: "stopping", verdict: "inconclusive", result_code: dispatch.code, next_step_at: new Date(now + 1000).toISOString() });
      return;
    }

    const confirmedAt = new Date().toISOString();
    const acknowledged = await sb.from("agent_test_lab_steps")
      .update({ status: "sent", confirmed_at: confirmedAt, provider_message_id: dispatch.providerMessageId, result_code: dispatch.deliveryStatus })
      .eq("id", pending.id);
    if (acknowledged.error) throw new Error("dispatch_ack_save_failed");
    await sb.from("agent_test_lab_messages").upsert({
      run_id: id, direction: "tester", kind: pending.kind, content: text.slice(0, 20000),
      provider_message_id: dispatch.providerMessageId, provider_occurred_at: confirmedAt,
    }, { onConflict: "run_id,direction,provider_message_id", ignoreDuplicates: true });
    await finish(sb, id, claimToken, { status: "waiting_reply", result_code: "waiting_agent_turn", next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString() });
    return;
  }

  const lastSent = [...steps].reverse().find(step => step.confirmed_at && step.status === "sent");
  if (!lastSent?.confirmed_at) {
    await finish(sb, id, claimToken, { status: "waiting_input", result_code: "waiting_owner_message", next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString() });
    return;
  }

  const replies = await sb.from("agent_test_lab_messages").select("received_at,provider_occurred_at")
    .eq("run_id", id).eq("direction", "agent").limit(1000);
  if (replies.error) throw new Error("replies_read_failed");
  const turn = labAgentTurnState({
    confirmedAt: lastSent.confirmed_at,
    agentMessageTimes: (replies.data ?? []).map(row => String(row.provider_occurred_at ?? row.received_at)),
    now,
  });

  if (turn.state === "waiting") {
    await sb.rpc("heartbeat_agent_test_lab_run_v1", { p_run_id: id, p_claim: claimToken });
    await finish(sb, id, claimToken, { status: "waiting_reply", result_code: "waiting_agent_turn", next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString() });
    return;
  }

  const expectation = (run.request?.scenario?.steps?.[lastSent.ordinal]?.expected?.type ?? "reply") as LabStepV1["expected"]["type"];
  const result = labStepVerdict(expectation, turn);
  await sb.from("agent_test_lab_evidence").upsert({
    run_id: id, check_code: `step_${lastSent.ordinal}`, verdict: result.verdict,
    description: `Etapa ${lastSent.ordinal + 1}: ${result.code}. Respostas do agente registradas: ${turn.messages}.`,
    resource_ids: [lastSent.id],
  }, { onConflict: "run_id,check_code" });
  await sb.from("agent_test_lab_steps").update({ status: "settled", result_code: result.code }).eq("id", lastSent.id);
  await finish(sb, id, claimToken, {
    status: "waiting_input", result_code: result.code,
    next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString(),
  });
}
