import { describe, expect, it } from "vitest";
import { measureEvolutionInboundLatency } from "@/lib/integrations/evolution-inbound-latency";

describe("measureEvolutionInboundLatency", () => {
  it("flags provider delays above 30 seconds", () => {
    expect(
      measureEvolutionInboundLatency("2026-07-22T14:00:00.000Z", "2026-07-22T14:01:00.000Z"),
    ).toEqual({ milliseconds: 60_000, seconds: 60, delayed: true });
  });

  it("keeps realtime delivery below the warning threshold", () => {
    expect(
      measureEvolutionInboundLatency("2026-07-22T14:00:00.000Z", "2026-07-22T14:00:09.500Z"),
    ).toEqual({ milliseconds: 9_500, seconds: 9.5, delayed: false });
  });

  it("ignores invalid timestamps and clamps future provider clocks", () => {
    expect(measureEvolutionInboundLatency("invalid", "2026-07-22T14:00:00.000Z")).toBeNull();
    expect(
      measureEvolutionInboundLatency("2026-07-22T14:00:05.000Z", "2026-07-22T14:00:00.000Z"),
    ).toEqual({ milliseconds: 0, seconds: 0, delayed: false });
  });
});
