import { describe, expect, it, vi } from "vitest";
import { recordAgentRuntimeMetric } from "@/lib/server/agent-runtime-metrics";

describe("agent runtime aggregate metrics", () => {
  it("sends only bounded aggregate fields", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await recordAgentRuntimeMetric({
      metric: "provider_call",
      subsystem: "evolution",
      outcome: "success",
      durationMs: 9_999_999,
      count: 999_999,
      sb: { rpc } as never,
    });
    expect(rpc).toHaveBeenCalledWith("record_agent_runtime_metric_v1", {
      p_metric_name: "provider_call",
      p_subsystem: "evolution",
      p_outcome: "success",
      p_duration_ms: 3_600_000,
      p_count: 100_000,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/tenant|phone|prompt|token|message/i);
  });

  it("never propagates observability failure", async () => {
    await expect(recordAgentRuntimeMetric({
      metric: "runtime_health_check",
      subsystem: "runtime",
      outcome: "failed",
      sb: { rpc: vi.fn().mockRejectedValue(new Error("offline")) } as never,
    })).resolves.toBeUndefined();
  });
});
