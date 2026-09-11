import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { LabRunRequestV1 } from "@/lib/agent-test-lab/contracts";
import { LAB_OWNER_ID, isLabInternalMode, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { inspectLabTarget } from "./preflight";
import { dispatchLabWorkflow, findLabWorkflow } from "./github";

export const LAB_RUN_PUBLIC_COLUMNS = "id,trace_id,mode,status,verdict,deployed_sha,config_hash,scenario_hash,target_tenant_id,target_agent_id,target_channel,max_messages,sent_messages,budget_brl,reserved_brl,spent_brl,deadline_at,workflow_run_id,result_code,created_at,updated_at,finished_at";
/** Modes whose executor is implemented and integration-tested. Everything else stays
 *  blocked in the backend: a visible button is not the same as a working feature. */
export const LAB_ENABLED_INTERACTIVE_MODES = new Set(["manual", "scripted", "correction"]);

export async function createLabRun(input: LabRunRequestV1) {
  const inspected = await inspectLabTarget(input);
  if (inspected.checks.some(check => !check.ok)) return { ok: false as const, code: "preflight_failed", checks: inspected.checks };
  const interactive = !isLabInternalMode(input.mode);
  if (interactive && !LAB_ENABLED_INTERACTIVE_MODES.has(input.mode)) throw new Error("real_test_dependencies_pending");
  const id = randomUUID();
  const sb = createSupabaseServiceClient();

  const targets: Record<string, unknown> = {};
  if (input.mode === "simulation") {
    if (!inspected.isolatedAgentId || input.targetKind !== "copy") throw new Error("simulation_copy_invalid");
    Object.assign(targets, { isolated_agent_id: inspected.isolatedAgentId, target_tenant_id: inspected.effective.tenantId,
      target_agent_id: inspected.effective.agentId, target_channel: input.channel });
  }
  // Simulation reaches no provider and no number, so it needs no destination.
  if (interactive && input.mode !== "simulation") {
    if (!inspected.targetJid || !inspected.senderJid || !inspected.senderConnectionId || !inspected.effective.connectionId) throw new Error("destination_unresolved");
    // The destination becomes usable only through this confirmation, which also
    // refuses a tester and an answering number that are the same line.
    // The effective target is what preflight resolved, which for an isolated copy is
    // the copy's own tenant, connection and rule — never the customer's.
    const target = inspected.effective;
    const confirmed = await sb.rpc("confirm_agent_test_lab_destination_v1", {
      p_owner: LAB_OWNER_ID, p_tenant_id: target.tenantId, p_connection_id: target.connectionId,
      p_channel: input.channel, p_target_jid: inspected.targetJid, p_sender_jid: inspected.senderJid,
    });
    if (confirmed.error) throw new Error("destination_confirmation_failed");
    Object.assign(targets, {
      sender_connection_id: inspected.senderConnectionId, target_tenant_id: target.tenantId,
      target_agent_id: target.agentId, target_connection_id: target.connectionId, target_rule_id: target.ruleId,
      target_channel: input.channel, target_jid: inspected.targetJid, target_form_id: input.formId,
      isolated_agent_id: inspected.isolatedAgentId,
      tester_jid: inspected.senderJid,
    });
  }

  const saved = await sb.from("agent_test_lab_runs").insert({ id, owner_admin_id: LAB_OWNER_ID, mode: input.mode,
    deployed_sha: inspected.sha, config_hash: inspected.configHash, scenario_hash: inspected.scenarioHash,
    request: input, preflight: inspected.checks, max_messages: input.limits.maxMessages, budget_brl: input.limits.budgetBrl,
    deadline_at: new Date(Date.now() + input.limits.maxMinutes * 60000).toISOString(), ...targets,
  }).select(LAB_RUN_PUBLIC_COLUMNS).single();
  if (saved.error || !saved.data) throw new Error("run_save_failed");
  return { ok: true as const, run: saved.data };
}

/** Routes a run to the executor that owns its mode. */
export async function tickLabRun(id: string, mode: string): Promise<void> {
  if (isLabInternalMode(mode)) return tickInternalLabRun(id);
  if (mode === "simulation") {
    const { tickSimulationLabRun } = await import("./simulation");
    return tickSimulationLabRun(id);
  }
  const { tickInteractiveLabRun } = await import("./executor");
  return tickInteractiveLabRun(id);
}
export async function listLabRuns() {
  const result = await createSupabaseServiceClient().from("agent_test_lab_runs").select(LAB_RUN_PUBLIC_COLUMNS)
    .eq("owner_admin_id", LAB_OWNER_ID).order("created_at", { ascending: false }).limit(50);
  if (result.error) throw new Error("runs_read_failed");
  return result.data ?? [];
}
/** Each tick has a lease and makes at most one runner dispatch. It never waits for a test suite. */
export async function tickInternalLabRun(id: string) {
  assertLabUuid(id);
  const sb = createSupabaseServiceClient();
  const claim = await sb.rpc("claim_agent_test_lab_run_v1", { p_run_id: id });
  if (claim.error) throw new Error("run_claim_failed");
  if (!claim.data?.claimToken) return;
  const claimToken = String(claim.data.claimToken);
  const loaded = await sb.from("agent_test_lab_runs").select("*").eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).single();
  if (loaded.error || !loaded.data) throw new Error("run_read_failed");
  const run = loaded.data;
  if (!isLabInternalMode(run.mode)) throw new Error("internal_worker_mode_rejected");
  const update = async (values: Record<string, unknown>) => {
    const saved = await sb.from("agent_test_lab_runs").update({ ...values, updated_at: new Date().toISOString(), claim_token: null, claim_expires_at: null,
      next_step_at: new Date(Date.now() + 15000).toISOString() }).eq("id", id).eq("claim_token", claimToken);
    if (saved.error) throw new Error("run_update_failed");
  };
  const owner = await sb.from("admin_users").select("id").eq("id", LAB_OWNER_ID).eq("active", true).eq("role", "super_admin").maybeSingle();
  if (owner.error || !owner.data || run.status === "stopping") {
    await update({ status: "cancelled", verdict: "inconclusive", result_code: run.result_code ?? "owner_or_stop_requested", finished_at: new Date().toISOString() });
    return;
  }
  try {
    let step = await sb.from("agent_test_lab_steps").select("id,dispatch_started_at,confirmed_at").eq("run_id", id).eq("ordinal", 0).maybeSingle();
    if (step.error) throw new Error("step_read_failed");
    if (!step.data) {
      const inserted = await sb.from("agent_test_lab_steps").insert({ run_id: id, ordinal: 0, kind: "workflow",
        idempotency_key: `lab-ci:${id}`, command: { profile: run.mode, sha: run.deployed_sha } }).select("id,dispatch_started_at,confirmed_at").single();
      if (inserted.error) throw new Error("step_save_failed");
      step = inserted;
    }
    if (!step.data?.dispatch_started_at) {
      const stepId = step.data!.id;
      const armed = await sb.rpc("arm_agent_test_lab_step_v1", { p_run_id: id, p_step_id: stepId, p_claim: claimToken });
      if (armed.error || armed.data !== true) throw new Error("dispatch_already_started");
      try {
        await dispatchLabWorkflow(id, run.mode, run.deployed_sha);
        const acknowledged = await sb.from("agent_test_lab_steps").update({ confirmed_at: new Date().toISOString(), status: "accepted" }).eq("id", stepId);
        if (acknowledged.error) throw new Error("dispatch_ack_save_failed");
      } catch {
        // Network uncertainty is evidence, never authorization for another dispatch.
        await update({ status: "running", result_code: "internal_dispatch_unknown" });
        return;
      }
    }
    const workflow = await findLabWorkflow(id, run.mode, run.deployed_sha);
    if (!workflow) { await update({ result_code: "internal_running" }); return; }
    if (workflow.status !== "completed") { await update({ workflow_run_id: workflow.id, result_code: "internal_running" }); return; }
    const passed = workflow.conclusion === "success";
    const failed = ["failure", "timed_out"].includes(workflow.conclusion ?? "");
    const verdict = passed ? "passed" : failed ? "failed" : "inconclusive";
    const evidence = await sb.from("agent_test_lab_evidence").upsert({ run_id: id, check_code: `internal_${run.mode}`, verdict,
      description: passed ? "Suíte aprovada no runner. Não comprova conversa real." : "Suíte sem aprovação; consultar o resultado do runner.",
      resource_ids: [String(workflow.id)] }, { onConflict: "run_id,check_code" });
    if (evidence.error) throw new Error("evidence_save_failed");
    await update({ workflow_run_id: workflow.id, status: passed ? "completed" : failed ? "failed" : "cancelled", verdict,
      result_code: passed ? "internal_passed" : failed ? "internal_failed" : "internal_cancelled", finished_at: new Date().toISOString() });
  } catch (error) {
    await update({ result_code: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "runner_check_failed" });
  }
}
/**
 * Recovers every run whose next step is due, of any mode. This is what makes the
 * laboratory survive a closed browser: the queued row, not the page, owns the work.
 */
export async function tickDueLabRuns() {
  if (process.env.AGENT_TEST_LAB_ENABLED !== "true") return { processed: 0, failed: 0 };
  const sb = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const due = await sb.from("agent_test_lab_runs").select("id,mode").eq("owner_admin_id", LAB_OWNER_ID)
    .or(`status.in.(queued,running,waiting_reply,stopping),and(status.in.(paused,waiting_input),deadline_at.lte.${nowIso})`)
    // Each turn may use most of the 60-second HTTP budget. Claim one due run;
    // independent dispatch invocations and the next cron recover the remainder.
    .lte("next_step_at", nowIso).order("next_step_at").limit(1);
  if (due.error) throw new Error("due_runs_read_failed");
  let processed = 0, failed = 0;
  for (const run of due.data ?? []) {
    // One stuck run must not stop the others from being recovered.
    try { await tickLabRun(String(run.id), String(run.mode)); processed += 1; } catch { failed += 1; }
  }
  return { processed, failed };
}
