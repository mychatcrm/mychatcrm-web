import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { tickLabRun } from "./runs";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// A turn can spend 45 seconds in the model/provider. Never start it at the end
// of a 60-second invocation; durable work remains available to the next claim.
const MIN_TURN_BUDGET_MS = 45_000;

/**
 * Drives one run for the length of a single invocation. It never waits for the whole
 * conversation: when the budget runs out the durable row is handed to the next
 * invocation, and the browser is not part of the chain at any point.
 */
export async function waitAndProcessLabRun(runId: string, invocationBudgetMs = 50_000): Promise<string> {
  assertLabUuid(runId);
  const sb = createSupabaseServiceClient();
  const deadline = Date.now() + invocationBudgetMs;
  while (Date.now() < deadline) {
    const current = await sb.from("agent_test_lab_runs").select("mode,status,next_step_at,deadline_at")
      .eq("id", runId).eq("owner_admin_id", LAB_OWNER_ID).maybeSingle();
    if (current.error) throw new Error("run_read_failed");
    if (!current.data) return "not_found";
    if (TERMINAL.has(String(current.data.status))) return String(current.data.status);
    if (["paused", "waiting_input"].includes(String(current.data.status)) && Date.parse(String(current.data.deadline_at)) > Date.now()) return "idle";

    const dueAt = Date.parse(String(current.data.next_step_at));
    if (Number.isFinite(dueAt) && dueAt > Date.now()) {
      const waitMs = Math.min(dueAt - Date.now(), deadline - Date.now());
      if (waitMs > 0) await sleep(Math.min(2000, Math.max(250, waitMs)));
      if (Date.now() < dueAt) continue;
    }
    if (deadline - Date.now() < MIN_TURN_BUDGET_MS) return "rescheduled";
    try { await tickLabRun(runId, String(current.data.mode)); }
    catch { await sleep(1000); }
  }
  return "rescheduled";
}

/**
 * Hands the run to a fresh invocation over the internal API. Failure here is not a
 * test failure: the row stays due and the recovery cron picks it up.
 */
export async function triggerLabRunProcessor(runId: string): Promise<boolean> {
  const token = process.env.INTERNAL_API_TOKEN?.trim() || process.env.CRON_SECRET?.trim();
  if (!token) return false;
  const base = (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
    || process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || "";
  if (!base) return false;
  try {
    const response = await fetch(new URL("/api/internal/agent-tests/dispatch", base).toString(), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
      body: JSON.stringify({ runId }), signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch { return false; }
}

/**
 * Starts work on a run. The separate invocation is preferred so this request can
 * answer immediately; when it is unavailable the tick still happens here, because
 * a queued step that nobody picks up is worse than a slower response.
 */
export async function startLabRunProcessing(runId: string, mode: string): Promise<void> {
  if (await triggerLabRunProcessor(runId)) return;
  await tickLabRun(runId, mode).catch(() => { /* The row stays due for the recovery cron. */ });
}
