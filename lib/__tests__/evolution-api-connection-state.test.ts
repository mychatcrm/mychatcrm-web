import { describe, expect, it } from "vitest";
import { normalizeEvolutionConnectionState, parseEvolutionConnectionStatePayload } from "@/lib/integrations/evolution-api";

describe("normalizeEvolutionConnectionState", () => {
  it("uses fallback for empty or non-string", () => {
    expect(normalizeEvolutionConnectionState(undefined)).toBe("close");
    expect(normalizeEvolutionConnectionState("")).toBe("close");
    expect(normalizeEvolutionConnectionState("   ")).toBe("close");
    expect(normalizeEvolutionConnectionState(123, "none")).toBe("none");
  });

  it("preserves non-empty state", () => {
    expect(normalizeEvolutionConnectionState("open")).toBe("open");
    expect(normalizeEvolutionConnectionState(" connecting ")).toBe("connecting");
  });
});

describe("parseEvolutionConnectionStatePayload", () => {
  it("reads instance.state", () => {
    expect(parseEvolutionConnectionStatePayload({ instance: { state: "connecting" } })).toBe("connecting");
  });

  it("reads top-level connectionState", () => {
    expect(parseEvolutionConnectionStatePayload({ connectionState: "open" })).toBe("open");
  });
});
