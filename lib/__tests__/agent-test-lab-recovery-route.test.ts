import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tick: vi.fn(), bearer: vi.fn(), audit: vi.fn(), deferred: [] as Promise<unknown>[] }));
vi.mock("@vercel/functions", () => ({ waitUntil: (promise: Promise<unknown>) => mocks.deferred.push(promise) }));
vi.mock("@/lib/server/internal-api-auth", () => ({ verifyInternalApiRequest: mocks.bearer }));
vi.mock("@/lib/server/agent-test-lab/runs", () => ({ tickDueLabRuns: mocks.tick }));
vi.mock("@/lib/server/operational-audit", () => ({ appendOperationalAuditEvent: mocks.audit }));
import { POST } from "@/app/api/internal/agent-tests/process/route";
const path = "/api/internal/agent-tests/process";
const secret = "synthetic-lab-recovery-secret-for-tests-only";
function signedRequest(query = "", signedPath = path) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "cf8d6c20-bfd2-4dcc-9cf4-c672ee7a0442";
  const signature = createHmac("sha256", secret).update(["POST",signedPath,timestamp,nonce].join("\n")).digest("hex");
  return new Request(`https://example.test${path}${query}`, { method: "POST", headers: {
    "x-mychatcrm-timestamp": timestamp, "x-mychatcrm-nonce": nonce, "x-mychatcrm-signature": `sha256=${signature}`,
  } });
}
describe("signed agent test laboratory recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.deferred.length = 0; mocks.bearer.mockReturnValue(false);
    mocks.tick.mockResolvedValue({ processed: 1, failed: 0 }); vi.stubEnv("META_LEADGEN_SCHEDULER_SECRET", secret); });
  afterEach(() => vi.unstubAllEnvs());
  it("acknowledges the scheduler before executing its bounded batch", async () => {
    expect((await POST(signedRequest())).status).toBe(202);
    expect(mocks.deferred).toHaveLength(1);
    await Promise.all(mocks.deferred);
    expect(mocks.tick).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorType: "cron", status: "completed",
      metadata: { processed: 1, failed: 0 } }));
  });
  it.each([["?run=forged",path],["","/api/internal/other"]])("rejects query and cross-route signatures", async (query,signedPath) => {
    expect((await POST(signedRequest(query,signedPath))).status).toBe(401);
    expect(mocks.tick).not.toHaveBeenCalled();
  });
  it("retains the existing authenticated worker behavior", async () => {
    mocks.bearer.mockReturnValue(true);
    const response = await POST(new Request(`https://example.test${path}`, { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, processed: 1, failed: 0 });
  });
  it("records background failure without returning a false test failure", async () => {
    mocks.tick.mockRejectedValue(new Error("synthetic failure"));
    expect((await POST(signedRequest())).status).toBe(202);
    await Promise.all(mocks.deferred);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorType: "cron", status: "error", resultCode: "lab_worker_failed" }));
  });
});
