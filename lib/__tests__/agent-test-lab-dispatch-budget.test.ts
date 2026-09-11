import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), tick: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/agent-test-lab/runs", () => ({ tickLabRun: mocks.tick }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: mocks.read };
  return { from: () => q };
} }));
import { waitAndProcessLabRun } from "@/lib/server/agent-test-lab/dispatch";
const id = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-01-01T00:00:00Z");
const running = { mode: "scripted", status: "running", next_step_at: now.toISOString(), deadline_at: "2026-01-01T01:00:00Z" };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());
describe("lab dispatch admission deadline", () => {
  it("leaves a due turn durable when the invocation has insufficient time", async () => {
    mocks.read.mockResolvedValue({ data: running });
    expect(await waitAndProcessLabRun(id, 44_999)).toBe("rescheduled");
    expect(mocks.tick).not.toHaveBeenCalled();
  });
  it("does not begin another slow turn after the first consumed the reserve", async () => {
    mocks.read.mockResolvedValue({ data: running });
    mocks.tick.mockImplementation(async () => { vi.setSystemTime(now.getTime() + 6_000); });
    expect(await waitAndProcessLabRun(id)).toBe("rescheduled");
    expect(mocks.tick).toHaveBeenCalledExactlyOnceWith(id, "scripted");
  });
  it("returns a recorded terminal result without dispatching again", async () => {
    mocks.read.mockResolvedValueOnce({ data: running }).mockResolvedValueOnce({ data: { ...running, status: "completed" } });
    mocks.tick.mockResolvedValue(undefined);
    expect(await waitAndProcessLabRun(id)).toBe("completed");
    expect(mocks.tick).toHaveBeenCalledTimes(1);
  });
  it("does not spend the turn reserve waiting and then call the provider", async () => {
    mocks.read.mockResolvedValue({ data: { ...running, next_step_at: new Date(now.getTime() + 10_000).toISOString() } });
    const result = waitAndProcessLabRun(id);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe("rescheduled");
    expect(mocks.tick).not.toHaveBeenCalled();
  });
});
