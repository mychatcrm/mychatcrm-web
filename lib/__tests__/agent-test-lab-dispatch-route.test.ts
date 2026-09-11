import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  verify: vi.fn(), wait: vi.fn(), trigger: vi.fn(), audit: vi.fn(), background: [] as Promise<unknown>[],
}));
vi.mock("@/lib/server/internal-api-auth", () => ({ verifyInternalApiRequest: mocks.verify }));
vi.mock("@/lib/server/agent-test-lab/dispatch", () => ({ waitAndProcessLabRun: mocks.wait, triggerLabRunProcessor: mocks.trigger }));
vi.mock("@/lib/server/operational-audit", () => ({ appendOperationalAuditEvent: mocks.audit }));
vi.mock("@vercel/functions", () => ({ waitUntil: (task: Promise<unknown>) => mocks.background.push(task) }));
import { POST } from "@/app/api/internal/agent-tests/dispatch/route";
const id = "33333333-3333-4333-8333-333333333333";
const req = () => new Request("https://lab.invalid/api/internal/agent-tests/dispatch", { method: "POST", body: JSON.stringify({ runId: id }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.background.length = 0;
  vi.stubEnv("AGENT_TEST_LAB_ENABLED", "true"); mocks.verify.mockReturnValue(true); mocks.audit.mockResolvedValue(undefined);
});
describe("durable lab dispatch", () => {
  it("acknowledges immediately while the worker is still pending", async () => {
    let release!: (value: string) => void;
    mocks.wait.mockReturnValue(new Promise<string>(resolve => { release = resolve; }));
    const response = await POST(req());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, outcome: "accepted" });
    expect(mocks.trigger).not.toHaveBeenCalled();
    release("rescheduled");
    await Promise.all(mocks.background);
    expect(mocks.trigger).toHaveBeenCalledExactlyOnceWith(id);
  });
  it("does not chain another worker when owner input is needed", async () => {
    mocks.wait.mockResolvedValue("idle");
    expect((await POST(req())).status).toBe(202);
    await Promise.all(mocks.background);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
  it("does not start a worker for an unauthenticated caller", async () => {
    mocks.verify.mockReturnValue(false);
    expect((await POST(req())).status).toBe(401);
    expect(mocks.wait).not.toHaveBeenCalled();
  });
  it("records background failure without claiming completion", async () => {
    mocks.wait.mockRejectedValue(new Error("private provider failure"));
    expect((await POST(req())).status).toBe(202);
    await Promise.all(mocks.background);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ status: "error", resultCode: "lab_dispatch_failed" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("private provider failure");
  });
});
