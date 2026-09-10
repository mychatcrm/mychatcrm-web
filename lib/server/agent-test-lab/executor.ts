import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_OWNER_ID, assertLabUuid, isLabInternalMode } from "@/lib/agent-test-lab/policy";
import { LAB_TICK_INTERVAL_SECONDS, LAB_MESSAGE_RESERVE_BRL, type LabStepV1, type LabRunRequestV1 } from "@/lib/agent-test-lab/contracts";
import { labAgentTurnState, labStepVerdict } from "@/lib/agent-test-lab/turn-policy";
import { labEffectVerdict, labDeliveryVerdict } from "@/lib/agent-test-lab/effect-policy";
import { dispatchLabText, dispatchLabMedia } from "./sender";
import { recordLabEffects } from "./effects";
import { labAggregateVerdict, labSafetyChecks } from "@/lib/agent-test-lab/safety-policy";
import { labFingerprint } from "./preflight";

/** Expectations that only the database can settle. */
const EFFECT_EXPECTATIONS = new Set<LabStepV1["expected"]["type"]>([
  "agenda_created", "agenda_cancelled", "follow_up", "reminder", "media_understood",
]);

type StepRow = {
  id: string; ordinal: number; kind: string; status: string; command: Record<string, unknown>;
  idempotency_key: string; dispatch_started_at: string | null; confirmed_at: string | null; result_code: string | null;
};

async function finish(sb: ReturnType<typeof createSupabaseServiceClient>, runId: string, claim: string, values: Record<string, unknown>) {
  if (["completed", "failed", "cancelled"].includes(String(values.status))) {
    // The RPC accepts only registered isolated copies outside customer tenants.
    // It refuses original/legacy scopes instead of pausing a customer's contact.
    const stopped = await sb.rpc("stop_agent_test_lab_automation_v2", { p_run_id: runId, p_claim: claim });
    if (stopped.error || stopped.data !== true) throw new Error("lab_automation_stop_unconfirmed");
  }
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
  const unsupported = labSafetyChecks({ ...run.request, mode: run.mode } as LabRunRequestV1).find(check => !check.ok);
  if (unsupported) {
    await finish(sb, id, claimToken, { status: "stopping", verdict: "not_executed", result_code: unsupported.code, next_step_at: new Date().toISOString() });
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
    const currentAgent = await sb.from("tenant_agents")
      .select("tenant_id,agent_id,display_name,system_prompt,model,metadata,active,review_reasons,archived_at,config_version")
      .eq("tenant_id", run.target_tenant_id).eq("agent_id", run.target_agent_id).single();
    if (currentAgent.error) throw new Error("target_read_failed");
    if (!currentAgent.data?.active || currentAgent.data.archived_at || labFingerprint(currentAgent.data) !== run.config_hash) {
      await finish(sb, id, claimToken, { status: "stopping", verdict: "inconclusive", result_code: "target_configuration_changed", next_step_at: new Date().toISOString() });
      return;
    }
    const armed = await sb.rpc("arm_agent_test_lab_step_v1", { p_run_id: id, p_step_id: pending.id, p_claim: claimToken });
    if (armed.error || armed.data !== true) {
      await finish(sb, id, claimToken, { result_code: "step_arm_rejected", next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString() });
      return;
    }
    const text = typeof pending.command.text === "string" ? pending.command.text : "";
    const assetId = typeof pending.command.assetId === "string" ? pending.command.assetId : null;
    const destination = {
      tenantId: String(run.target_tenant_id), connectionId: String(run.target_connection_id),
      channel: String(run.target_channel), targetJid: String(run.target_jid),
      authorizeDispatch: async () => {
        const result = await sb.rpc("authorize_agent_test_lab_step_dispatch_v3", { p_run_id: id, p_step_id: pending.id, p_claim: claimToken });
        if (result.error) throw new Error("dispatch_authorization_unavailable");
        return result.data === true;
      },
    };
    // An attachment counts as a message and travels the same authorized path.
    const dispatch = assetId
      ? await dispatchLabMedia({ ...destination, assetId, caption: text })
      : await dispatchLabText({ ...destination, text });

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

  const drivenRun = run.mode === "scripted" || run.mode === "autonomous" || run.mode === "correction";
  const lastSent = [...steps].reverse().find(step => step.confirmed_at && ["sent", "settled", "waiting_timer"].includes(step.status));
  if (!lastSent?.confirmed_at) {
    // A driven run opens the conversation itself; a manual one waits for the owner.
    if (drivenRun && steps.length === 0) {
      const opening = await nextDrivenMessage({ run, ordinal: -1, replies: [] });
      if (opening) {
        const queued = await sb.rpc("enqueue_agent_test_lab_step_v3", {
          p_run_id: id, p_owner: LAB_OWNER_ID, p_kind: opening.kind, p_command: stepCommand(opening),
          p_key: `lab-step:${id}:0`, p_reserve: opening.kind === "wait" ? 0 : LAB_MESSAGE_RESERVE_BRL,
        });
        if (!queued.error && queued.data?.ok === true) {
          await finish(sb, id, claimToken, { status: "running", result_code: "opening_queued", next_step_at: new Date(now).toISOString() });
          return;
        }
      }
      await finish(sb, id, claimToken, { status: "failed", verdict: "not_executed",
        result_code: "no_opening_message", finished_at: new Date().toISOString() });
      return;
    }
    await finish(sb, id, claimToken, { status: "waiting_input", result_code: "waiting_owner_message", next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString() });
    return;
  }

  const replies = await sb.from("agent_test_lab_messages").select("received_at,provider_occurred_at")
    .eq("run_id", id).eq("direction", "agent").limit(1000);
  if (replies.error) throw new Error("replies_read_failed");
  const waitStep = lastSent.kind === "wait";
  const observedSince = waitStep ? lastSent.dispatch_started_at! : lastSent.confirmed_at;
  let turn = labAgentTurnState({
    confirmedAt: observedSince,
    agentMessageTimes: (replies.data ?? []).map(row => String(row.provider_occurred_at ?? row.received_at)),
    now,
  });
  if (waitStep) {
    const messages = (replies.data ?? []).filter(row => {
      const at = Date.parse(String(row.provider_occurred_at ?? row.received_at));
      return at >= Date.parse(observedSince) && at <= Date.parse(lastSent.confirmed_at!);
    }).length;
    turn = { state: now < Date.parse(lastSent.confirmed_at) ? "waiting" : messages ? "complete" : "timed_out", messages };
  }

  if (turn.state === "waiting") {
    await sb.rpc("heartbeat_agent_test_lab_run_v1", { p_run_id: id, p_claim: claimToken });
    await finish(sb, id, claimToken, { status: "waiting_reply", result_code: "waiting_agent_turn", next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString() });
    return;
  }

  const expectation = (run.request?.scenario?.steps?.[lastSent.ordinal]?.expected?.type ?? "reply") as LabStepV1["expected"]["type"];
  const turnResult = labStepVerdict(expectation, turn);

  // An effect expectation is settled against the database, never against the reply.
  // "Agendado para amanhã" is a sentence; an appointment is a row.
  let result = turnResult;
  if (EFFECT_EXPECTATIONS.has(expectation)) {
    const observed = await recordLabEffects(id);
    const settled = labEffectVerdict(expectation, observed, {
      elapsedMs: now - Date.parse(String(run.created_at)),
      requiredMs: waitStep ? Date.parse(lastSent.confirmed_at) - Date.parse(String(run.created_at))
        : Date.parse(String(run.deadline_at)) - Date.parse(String(run.created_at)),
    });
    result = { verdict: settled.verdict, code: settled.code };
    await sb.from("agent_test_lab_evidence").upsert({
      run_id: id, check_code: `effects_${lastSent.ordinal}`, verdict: settled.verdict,
      description: settled.description, resource_ids: [],
    }, { onConflict: "run_id,check_code" });
    const delivery = labDeliveryVerdict(observed);
    await sb.from("agent_test_lab_evidence").upsert({
      run_id: id, check_code: `delivery_${lastSent.ordinal}`, verdict: delivery.verdict,
      description: delivery.description, resource_ids: [],
    }, { onConflict: "run_id,check_code" });
  }

  await sb.from("agent_test_lab_evidence").upsert({
    run_id: id, check_code: `step_${lastSent.ordinal}`, verdict: result.verdict,
    description: `Etapa ${lastSent.ordinal + 1}: ${result.code}. Respostas do agente registradas: ${turn.messages}.`,
    resource_ids: [lastSent.id],
  }, { onConflict: "run_id,check_code" });
  await sb.from("agent_test_lab_steps").update({ status: "settled", result_code: result.code }).eq("id", lastSent.id);

  // Manual runs hand control back to the owner. A driven run decides its own next
  // message, and closes when the script is finished or the agent stopped talking.
  if (!drivenRun) {
    await finish(sb, id, claimToken, {
      status: "waiting_input", result_code: result.code,
      next_step_at: new Date(now + LAB_TICK_INTERVAL_SECONDS * 1000).toISOString(),
    });
    return;
  }

  const next = await nextDrivenMessage({ run, ordinal: lastSent.ordinal, replies: replies.data ?? [] });
  if (!next) {
    await finish(sb, id, claimToken, await summariseLabRun(sb, id, result.code));
    return;
  }
  const queued = await sb.rpc("enqueue_agent_test_lab_step_v3", {
    p_run_id: id, p_owner: LAB_OWNER_ID, p_kind: next.kind, p_command: stepCommand(next),
    p_key: `lab-step:${id}:${lastSent.ordinal + 1}`, p_reserve: next.kind === "wait" ? 0 : LAB_MESSAGE_RESERVE_BRL,
  });
  if (queued.error || queued.data?.ok !== true) {
    // A limit reached mid-script is the end of the run, not an error in it.
    await finish(sb, id, claimToken, await summariseLabRun(sb, id, String(queued.data?.code ?? "step_queue_rejected")));
    return;
  }
  await finish(sb, id, claimToken, { status: "running", result_code: result.code, next_step_at: new Date(now).toISOString() });
}

/**
 * The next message of a driven run. A script reads its own next line; an autonomous
 * run asks the tester model. Either way the destination is fixed and already
 * authorized — the message text is the only thing that varies.
 */
async function nextDrivenMessage(params: {
  run: Record<string, unknown>; ordinal: number;
  replies: { provider_occurred_at?: string | null; received_at?: string | null }[];
}): Promise<LabStepV1 | null> {
  const run = params.run as { mode: string; request: LabRunRequestV1; max_messages: number; sent_messages: number;
    target_tenant_id: string | null; target_agent_id: string | null; id: string };
  const scenario = run.request?.scenario;
  if (run.mode === "scripted" || run.mode === "correction") {
    const step = scenario?.steps?.[params.ordinal + 1];
    return step ?? null;
  }
  const sb = createSupabaseServiceClient();
  const transcript = await sb.from("agent_test_lab_messages").select("direction,content")
    .eq("run_id", run.id).order("received_at").limit(200);
  if (transcript.error) throw new Error("transcript_read_failed");
  const { nextLabTesterMessage } = await import("./tester-ai");
  const text = await nextLabTesterMessage({
    labTenantId: String(run.target_tenant_id ?? ""), labAgentId: String(run.target_agent_id ?? ""),
    model: run.request?.testerModel, scenario,
    transcript: (transcript.data ?? []) as { direction: "tester" | "agent"; content: string | null }[],
    remaining: Math.max(0, Number(run.max_messages) - Number(run.sent_messages)),
  });
  return text ? { kind: "text", text, expected: { type: "reply" } } : null;
}

function stepCommand(step: LabStepV1): Record<string, unknown> {
  if (step.kind === "wait") return { waitSeconds: step.waitSeconds };
  return step.kind === "text" ? { text: step.text } : { text: step.text ?? "", assetId: step.assetId };
}

/** The aggregate verdict: a run is only as good as its weakest settled step. */
async function summariseLabRun(sb: ReturnType<typeof createSupabaseServiceClient>, runId: string, code: string) {
  const evidence = await sb.from("agent_test_lab_evidence").select("verdict").eq("run_id", runId).limit(1000);
  if (evidence.error) throw new Error("evidence_read_failed");
  const verdicts = (evidence.data ?? []).map(row => String(row.verdict));
  const run = await sb.from("agent_test_lab_runs").select("mode,request").eq("id", runId).single();
  const steps = await sb.from("agent_test_lab_steps").select("id", { count: "exact", head: true }).eq("run_id", runId).eq("status", "settled");
  if (run.error || steps.error) throw new Error("evidence_read_failed");
  const planned = ["scripted", "correction"].includes(String(run.data.mode)) ? run.data.request?.scenario?.steps?.length ?? 0 : 0;
  const verdict = labAggregateVerdict(verdicts, planned, steps.count ?? 0);
  return { status: verdict === "failed" ? "failed" : "completed", verdict, result_code: code, finished_at: new Date().toISOString() };
}
