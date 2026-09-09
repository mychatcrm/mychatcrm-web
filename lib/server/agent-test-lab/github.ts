import "server-only";
import { isLabInternalMode } from "@/lib/agent-test-lab/policy";

const ROOT = "https://api.github.com/repos/mychatcrm/mychatcrm-web";
const WORKFLOW = "agent-test-lab.yml";
const SHA = /^[a-f0-9]{40}$/;
async function github(path: string, method = "GET", body?: unknown): Promise<Response> {
  const token = process.env.AGENT_TEST_LAB_GITHUB_TOKEN;
  if (!token) throw new Error("github_not_configured");
  // Paths are entirely constructed by this module. No caller-controlled URL.
  const response = await fetch(`${ROOT}${path}`, {
    method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "github_access_denied" : "github_unavailable");
  return response;
}
/** Only the deployed, reviewed commit may run; never a branch/script from the UI. */
export async function dispatchLabWorkflow(runId: string, mode: string, sha: string) {
  if (!isLabInternalMode(mode) || !SHA.test(sha) || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error("workflow_input_rejected");
  await github(`/actions/workflows/${WORKFLOW}/dispatches`, "POST", { ref: "main", inputs: { profile: mode, sha, lab_run_id: runId } });
}
type WorkflowRun = { id: number; display_title: string; head_sha: string; event: string; status: string; conclusion: string | null; html_url: string };
export async function findLabWorkflow(runId: string, mode: string, sha: string): Promise<WorkflowRun | null> {
  if (!isLabInternalMode(mode) || !SHA.test(sha) || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error("workflow_input_rejected");
  const response = await github(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100`);
  const body = await response.json() as { workflow_runs?: WorkflowRun[] };
  // The workflow's run-name includes the tested SHA (which may differ from dispatch head).
  return body.workflow_runs?.find(run => run.display_title === `Lab ${runId} ${mode} ${sha}` && run.event === "workflow_dispatch") ?? null;
}
export async function hasApprovedLabCI(sha: string): Promise<boolean> {
  if (!SHA.test(sha)) return false;
  const response = await github(`/actions/workflows/ci.yml/runs?head_sha=${sha}&status=success&per_page=20`);
  const body = await response.json() as { workflow_runs?: WorkflowRun[] };
  return Boolean(body.workflow_runs?.some(run => run.head_sha === sha && run.conclusion === "success" && ["push", "pull_request"].includes(run.event)));
}
