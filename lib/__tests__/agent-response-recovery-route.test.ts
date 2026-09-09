import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ process: vi.fn(), audit: vi.fn(), wait: vi.fn(), bearer: vi.fn(), deferred: [] as Promise<unknown>[] }));
vi.mock("@vercel/functions", () => ({ waitUntil: (promise: Promise<unknown>) => mocks.deferred.push(promise) }));
vi.mock("@/lib/server/agent-response-jobs", () => ({ processDueAgentResponseJobs: mocks.process, waitAndProcessAgentResponseJob: mocks.wait }));
vi.mock("@/lib/server/agent-response-fallback", () => ({ executeAgentResponseFallback: vi.fn(), loadAgentResponseJob: vi.fn() }));
vi.mock("@/lib/server/internal-api-auth", () => ({ verifyInternalApiRequest: mocks.bearer }));
vi.mock("@/lib/server/operational-audit", () => ({ appendOperationalAuditEvent: mocks.audit }));
import { POST } from "@/app/api/internal/agent-response-jobs/process/route";

const path = "/api/internal/agent-response-jobs/process";
const secret = "synthetic-scheduler-secret-only-for-test-123";
function request(query = "", signedPath = path, method = "POST") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "b7e2312d-5c98-4bcb-a296-7e32bc31c0b9";
  const signature = createHmac("sha256", secret).update(["POST", signedPath, timestamp, nonce].join("\n")).digest("hex");
  return new Request(`https://example.test${path}${query}`, { method, headers: {
    "x-mychatcrm-timestamp": timestamp, "x-mychatcrm-nonce": nonce, "x-mychatcrm-signature": `sha256=${signature}`,
  } });
}
describe("signed response recovery", () => {
  beforeEach(() => {
    vi.stubEnv("META_LEADGEN_SCHEDULER_SECRET", secret);
    vi.clearAllMocks(); mocks.deferred.length = 0;
    mocks.bearer.mockReturnValue(false); mocks.process.mockResolvedValue(0);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("acknowledges quickly, runs a bounded batch, and audits completion", async () => {
    expect((await POST(request())).status).toBe(202);
    await Promise.all(mocks.deferred);
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "run.completed", metadata: { processed: 0 } }));
  });
  it.each([["?jobId=forged", path, "POST"], ["", "/api/internal/other", "POST"], ["", path, "GET"]])("rejects unsigned inputs and cross-worker signatures", async (query, signedPath, method) => {
    expect((await POST(request(query, signedPath, method))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.wait).not.toHaveBeenCalled();
  });
  it("records recovery errors instead of claiming completion", async () => {
    mocks.process.mockRejectedValueOnce(new Error("synthetic failure"));
    await POST(request()); await Promise.all(mocks.deferred);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "run.failed", resultCode: "response_recovery_failed" }));
    expect(mocks.audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "run.completed" }));
  });
  it("keeps existing bearer job dispatch and uses the route's real time limit", async () => {
    mocks.bearer.mockReturnValue(true); mocks.wait.mockResolvedValue("rescheduled");
    expect((await POST(request("?jobId=synthetic-job"))).status).toBe(200);
    expect(mocks.wait).toHaveBeenCalledWith("synthetic-job", undefined, 120000);
  });
});
