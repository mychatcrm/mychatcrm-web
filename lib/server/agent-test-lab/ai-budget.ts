import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { withAiExecutionBudget } from "@/lib/ai/execution-budget";
import { LAB_AI_BILLING_TENANT, labAiActualCost, labAiBudgetQuote } from "@/lib/agent-test-lab/ai-budget-policy";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";

/** One durable step's AI calls, including nested tool/localization generations. */
export async function withLabAiBudget<T>(params: {
  runId: string; claim: string; operation: string; category: "tester_ai" | "agent_ai" | "evaluator_ai";
}, task: () => Promise<T>): Promise<T> {
  assertLabUuid(params.runId); assertLabUuid(params.claim);
  if (!/^[a-z0-9_:-]{1,80}$/.test(params.operation)) throw new Error("lab_ai_operation_invalid");
  const sb = createSupabaseServiceClient();
  const run = await sb.from("agent_test_lab_runs").select("id,deadline_at,claim_expires_at,claim_token")
    .eq("id", params.runId).eq("owner_admin_id", LAB_OWNER_ID).single();
  if (run.error || !run.data || run.data.claim_token !== params.claim) throw new Error("lab_ai_claim_invalid");
  const deadline = Math.min(Date.parse(run.data.deadline_at), Date.parse(run.data.claim_expires_at), Date.now() + 45000) - 2000;
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error("lab_ai_deadline_reached");
  const rate = Number(process.env.AI_COST_USD_BRL_RATE ?? "5.5");
  let sequence = 0;
  return withAiExecutionBudget({ deadline, invoke: async (input, execute) => {
    if (Date.now() >= deadline) throw new Error("lab_ai_deadline_reached");
    const quote = labAiBudgetQuote(input, rate);
    const key = `lab-ai:${params.runId}:${params.operation}:${sequence++}`;
    const reserved = await sb.rpc("reserve_agent_test_lab_ai_cost_v3", {
      p_run_id: params.runId, p_claim: params.claim, p_key: key, p_category: params.category, p_reserve: quote.reservedBrl,
    });
    if (reserved.error || reserved.data?.ok !== true) throw new Error(
      reserved.data?.code === "budget_exhausted" ? "lab_ai_budget_exhausted" : "lab_ai_reservation_rejected");
    // Prompt/configuration resolution already happened in the normal engine.
    // Only usage attribution changes, never authorization or tool permissions.
    const result = await execute({ ...input, tenantId: LAB_AI_BILLING_TENANT, customerId: null,
      metadata: { ...input.metadata, labRunId: params.runId, labCategory: params.category } });
    const actual = labAiActualCost(result, quote);
    if (actual === null) throw new Error("lab_ai_usage_unconfirmed");
    const settled = await sb.rpc("settle_agent_test_lab_cost_v1", {
      p_run_id: params.runId, p_key: key, p_actual: actual,
      p_provider_id: result.ok ? result.providerRequestId ?? null : null,
    });
    if (settled.error || settled.data !== true) throw new Error("lab_ai_cost_settlement_unconfirmed");
    if (actual > quote.reservedBrl) throw new Error("lab_ai_cost_exceeded_reservation");
    return result;
  } }, task);
}
