import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { simulateAgentTurnV2 } from "@/lib/server/process-agent-turn-v2";
import type { Agent } from "@/lib/types";
import type { LabScenarioV1, LabVerdict, LabRunRequestV1 } from "@/lib/agent-test-lab/contracts";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { provisionLabIsolatedAgent } from "./isolation";
import { labSimulationVerdict, labSimulatedEffects } from "@/lib/agent-test-lab/simulation-policy";
import { requireCertifiedLabCapability } from "@/lib/agent-test-lab/safety-policy";

export type LabSimulatedTurn = {
  ordinal: number; message: string; reply: string;
  verdict: LabVerdict; code: string; description: string;
  effects: { effect_type: string; details: Record<string, unknown> }[];
};

function agentFromRow(row: Record<string, unknown>, agentId: string): Partial<Agent> & { nome?: string; systemPrompt?: string } {
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Partial<Agent>) : {};
  const hasPromptFields = ["instructionMode", "simplePrompt", "promptIdentidade", "promptObjetivo", "systemPrompt",
    "promptRegrasAdicionais", "respostasProibidas"].some(key => Object.prototype.hasOwnProperty.call(metadata, key));
  return {
    ...metadata,
    nome: typeof row.display_name === "string" ? row.display_name : metadata.nome ?? agentId,
    systemPrompt: hasPromptFields ? metadata.systemPrompt ?? "" : typeof row.system_prompt === "string" ? row.system_prompt : "",
  };
}

/**
 * Runs the scenario against the isolated copy. Nothing is sent and nothing is
 * mutated; the agent's own authorization, journey and protection rules still apply
 * inside the turn, because this is the production engine, not a rehearsal of it.
 */
export async function runLabSimulation(params: {
  labTenantId: string; labAgentId: string; scenario: LabScenarioV1; model?: string | null;
}): Promise<LabSimulatedTurn[]> {
  requireCertifiedLabCapability("paid_lab_execution");
  const sb = createSupabaseServiceClient();
  const row = await sb.from("tenant_agents").select("agent_id,display_name,system_prompt,model,metadata,review_reasons")
    .eq("tenant_id", params.labTenantId).eq("agent_id", params.labAgentId).maybeSingle();
  if (row.error) throw new Error("simulation_agent_read_failed");
  if (!row.data) throw new Error("simulation_agent_missing");

  const agent = agentFromRow(row.data as Record<string, unknown>, params.labAgentId);
  const reviewReasons = Array.isArray(row.data.review_reasons)
    ? row.data.review_reasons.filter((reason): reason is string => typeof reason === "string") : [];
  const turns: LabSimulatedTurn[] = [];

  for (const [ordinal, step] of params.scenario.steps.entries()) {
    if (step.kind !== "text" || !step.text?.trim()) {
      turns.push({ ordinal, message: step.text ?? "", reply: "",
        verdict: "not_executed", code: "simulation_supports_text_only",
        description: "A simulação exercita apenas mensagens de texto. Mídia exige uma execução real.", effects: [] });
      continue;
    }
    const result = await simulateAgentTurnV2({
      sb, tenantId: params.labTenantId, agentId: params.labAgentId, agent,
      message: step.text, model: params.model ?? (typeof row.data.model === "string" ? row.data.model : undefined),
      reviewReasons,
    });
    if (!result.ok && !result.decision) {
      turns.push({ ordinal, message: step.text, reply: "", verdict: "inconclusive", code: result.error,
        description: "O turno não chegou a uma decisão auditável.", effects: [] });
      continue;
    }
    const decision = result.decision!;
    const read = labSimulationVerdict(step.expected.type, decision);
    turns.push({ ordinal, message: step.text, reply: decision.reply ?? "", ...read, effects: labSimulatedEffects(decision) });
  }
  return turns;
}

/**
 * Runs a whole simulation inside one claim. There is no provider to wait for, so
 * the run reaches a verdict in a single pass instead of parking between steps.
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
  const close = async (values: Record<string, unknown>) => {
    const saved = await sb.from("agent_test_lab_runs")
      .update({ ...values, updated_at: new Date().toISOString(), claim_token: null, claim_expires_at: null, finished_at: new Date().toISOString() })
      .eq("id", id).eq("claim_token", claimToken);
    if (saved.error) throw new Error("run_update_failed");
  };
  if (run.status === "stopping") {
    await close({ status: "cancelled", verdict: "inconclusive", result_code: run.result_code ?? "stopped_by_owner" });
    return;
  }

  const request = run.request as LabRunRequestV1;
  try {
    const copy = await provisionLabIsolatedAgent(request.tenantId, request.agentId);
    for (const dependency of copy.unavailable) {
      await sb.from("agent_test_lab_evidence").upsert({
        run_id: id, check_code: `dependency_${dependency.dependency}`, verdict: "not_executed",
        description: dependency.reason, resource_ids: [],
      }, { onConflict: "run_id,check_code" });
    }
    await sb.from("agent_test_lab_runs").update({ isolated_agent_id: copy.id }).eq("id", id);

    const turns = await runLabSimulation({
      labTenantId: copy.labTenantId, labAgentId: copy.labAgentId,
      scenario: request.scenario, model: request.testerModel,
    });

    for (const turn of turns) {
      await sb.from("agent_test_lab_messages").upsert([
        { run_id: id, direction: "tester", kind: "text", content: turn.message.slice(0, 20000),
          provider_message_id: `sim:${turn.ordinal}:tester`, provider_occurred_at: new Date().toISOString() },
        { run_id: id, direction: "agent", kind: "text", content: turn.reply.slice(0, 20000),
          provider_message_id: `sim:${turn.ordinal}:agent`, provider_occurred_at: new Date().toISOString() },
      ], { onConflict: "run_id,direction,provider_message_id", ignoreDuplicates: true });
      await sb.from("agent_test_lab_evidence").upsert({
        run_id: id, check_code: `step_${turn.ordinal}`, verdict: turn.verdict,
        description: `Etapa ${turn.ordinal + 1}: ${turn.description}`, resource_ids: [],
      }, { onConflict: "run_id,check_code" });
      for (const effect of turn.effects) {
        await sb.from("agent_test_lab_effects").upsert({
          run_id: id, effect_type: effect.effect_type, resource_table: "simulation", resource_id: String(turn.ordinal),
          details: effect.details,
        }, { onConflict: "run_id,effect_type,resource_table,resource_id", ignoreDuplicates: true });
      }
    }

    // The run is only as good as its weakest step, and a stale copy is not a result.
    const verdicts = turns.map(turn => turn.verdict);
    const verdict = verdicts.includes("failed") ? "failed"
      : verdicts.includes("inconclusive") ? "inconclusive"
      : verdicts.length && verdicts.every(value => value === "passed" || value === "expected_block") ? "passed"
      : "not_executed";
    await close({ status: verdict === "failed" ? "failed" : "completed", verdict,
      result_code: copy.unavailable.length ? "simulation_with_unavailable_dependencies" : "simulation_completed" });
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "simulation_failed";
    await close({ status: "failed", verdict: "inconclusive", result_code: code });
  }
}
