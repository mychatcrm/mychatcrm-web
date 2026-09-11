import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { simulateAgentTurnV2 } from "@/lib/server/process-agent-turn-v2";
import { createSimulationAgendaExecutionPort } from "@/lib/server/agent-cta-scheduler";
import type { Agent } from "@/lib/types";
import { parseLabRunRequest, type LabVerdict, type LabStepV1 } from "@/lib/agent-test-lab/contracts";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { inspectLabIsolatedAgent } from "./isolation";
import { labFingerprint } from "./preflight";
import { labSimulationVerdict, labSimulatedEffects } from "@/lib/agent-test-lab/simulation-policy";
import { labSimulationHistory, parseLabSimulationState } from "@/lib/agent-test-lab/simulation-state";
import { requireCertifiedLabCapability } from "@/lib/agent-test-lab/safety-policy";
import { withLabAiBudget } from "./ai-budget";

export type LabSimulatedTurn = {
  ordinal: number; message: string; reply: string;
  verdict: LabVerdict; code: string; description: string;
  effects: { effect_type: string; details: Record<string, unknown> }[];
};

function agentFromRow(row: Record<string, unknown>, agentId: string): Partial<Agent> {
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Partial<Agent>) : {};
  const hasPromptFields = ["instructionMode", "simplePrompt", "promptIdentidade", "promptObjetivo", "systemPrompt",
    "promptRegrasAdicionais", "respostasProibidas"].some(key => Object.prototype.hasOwnProperty.call(metadata, key));
  return { ...metadata,
    nome: typeof row.display_name === "string" ? row.display_name : metadata.nome ?? agentId,
    systemPrompt: hasPromptFields ? metadata.systemPrompt ?? "" : typeof row.system_prompt === "string" ? row.system_prompt : "",
  };
}

function unsupportedTurn(ordinal: number, step: LabStepV1): LabSimulatedTurn {
  return { ordinal, message: step.text ?? "", reply: "", verdict: "not_executed",
    code: "simulation_supports_text_only", description: "Mídia e temporizadores reais não foram executados nesta simulação.", effects: [] };
}

/** One claim, at most one model turn. Draft/history stay private to this run.
 * Dry-run decisions do not certify delivery, authorization or real side effects.
 */
export async function tickSimulationLabRun(id: string): Promise<void> {
  assertLabUuid(id);
  const sb = createSupabaseServiceClient();
  const claim = await sb.rpc("claim_agent_test_lab_run_v1", { p_run_id: id });
  if (claim.error) throw new Error("run_claim_failed");
  if (!claim.data?.claimToken) return;
  const claimToken = String(claim.data.claimToken);
  const loaded = await sb.from("agent_test_lab_runs").select("*").eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).single();
  if (loaded.error || !loaded.data) throw new Error("run_read_failed");
  const run = loaded.data;
  if (run.mode !== "simulation") throw new Error("simulation_worker_mode_rejected");
  const close = async (values: Record<string, unknown>) => {
    const saved = await sb.from("agent_test_lab_runs").update({ ...values, updated_at: new Date().toISOString(),
      claim_token: null, claim_expires_at: null, finished_at: new Date().toISOString() })
      .eq("id", id).eq("claim_token", claimToken);
    if (saved.error) throw new Error("run_update_failed");
  };
  if (run.status === "stopping") {
    await close({ status: "cancelled", verdict: "inconclusive", result_code: run.result_code ?? "stopped_by_owner" });
    return;
  }
  try {
    requireCertifiedLabCapability("paid_lab_execution");
    const request = parseLabRunRequest(run.request);
    const copy = await inspectLabIsolatedAgent(request.tenantId, request.agentId);
    if (request.targetKind !== "copy" || !copy || copy.stale || copy.id !== run.isolated_agent_id
      || copy.labTenantId !== run.target_tenant_id || copy.labAgentId !== run.target_agent_id) throw new Error("simulation_copy_invalid");
    // This worker never provisions or rewrites the copy while a test is running.
    const row = await sb.from("tenant_agents").select("tenant_id,agent_id,display_name,system_prompt,model,metadata,active,review_reasons,archived_at,config_version")
      .eq("tenant_id", copy.labTenantId).eq("agent_id", copy.labAgentId).single();
    if (row.error || !row.data || !row.data.active || row.data.archived_at) throw new Error("simulation_agent_unavailable");
    if (labFingerprint(row.data) !== run.config_hash || labFingerprint(request.scenario) !== run.scenario_hash) throw new Error("simulation_configuration_changed");
    const state = parseLabSimulationState(run.simulation_state);
    const step = request.scenario.steps[state.nextOrdinal];
    if (!step) throw new Error("simulation_step_missing");
    const transcript = await sb.from("agent_test_lab_messages").select("direction,content,provider_message_id,provider_occurred_at")
      .eq("run_id", id).order("provider_occurred_at", { ascending: false }).limit(20);
    if (transcript.error) throw new Error("simulation_history_read_failed");
    const history = labSimulationHistory(transcript.data ?? [], state.nextOrdinal);
    const port = createSimulationAgendaExecutionPort({ pendingAction: state.pendingAction });
    // Commit the start before a paid call: a crash cannot cause an automatic replay.
    const started = await sb.rpc("begin_agent_test_lab_simulation_step_v5", { p_run: id, p_claim: claimToken, p_ordinal: state.nextOrdinal });
    if (started.error || !started.data) throw new Error("simulation_step_start_rejected");
    let turn = unsupportedTurn(state.nextOrdinal, step);
    if (step.kind === "text") {
      const result = await withLabAiBudget({ runId: id, claim: claimToken, operation: `simulation:${state.nextOrdinal}`, category: "agent_ai" }, () => simulateAgentTurnV2({
        sb, tenantId: copy.labTenantId, agentId: copy.labAgentId, agent: agentFromRow(row.data, copy.labAgentId),
        message: step.text!, model: request.testerModel!, remoteJid: `simulation:${id}`, channel: request.channel,
        reviewReasons: Array.isArray(row.data.review_reasons) ? row.data.review_reasons : [],
        simulationContext: { history, agendaPort: port },
      }));
      if (!result.ok && !result.decision) throw new Error("simulation_turn_unconfirmed");
      const decision = result.decision!;
      turn = { ordinal: state.nextOrdinal, message: step.text!, reply: decision.reply ?? "",
        ...labSimulationVerdict(step.expected.type, decision), effects: labSimulatedEffects(decision) };
      if (copy.unavailable.length && turn.verdict === "passed") {
        turn = { ...turn, verdict: "inconclusive", code: "simulation_dependencies_unavailable",
          description: "A resposta foi gerada, mas a cópia não possui todas as dependências do agente original." };
      }
    }
    const saved = await sb.rpc("complete_agent_test_lab_simulation_step_v5", {
      p_run: id, p_claim: claimToken, p_step: started.data, p_result: turn, p_pending: port.snapshotPendingAction(),
    });
    if (saved.error) throw new Error("simulation_result_save_failed");
    // false means pause/stop/expired claim won the race. Do not repeat the call.
    if (saved.data !== true) return;
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "simulation_failed";
    await close({ status: "failed", verdict: "inconclusive", result_code: code });
  }
}
