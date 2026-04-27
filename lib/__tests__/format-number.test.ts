import { describe, expect, it } from "vitest";
import { formatDemoCreditsCompactPtBr, formatIntegerPtBr, formatMillionsShortPtBr } from "../format-number";

describe("formatIntegerPtBr", () => {
  it("formats zero and groups thousands with pt-BR dots", () => {
    expect(formatIntegerPtBr(0)).toBe("0");
    expect(formatIntegerPtBr(999)).toBe("999");
    expect(formatIntegerPtBr(1000)).toBe("1.000");
    expect(formatIntegerPtBr(1234567)).toBe("1.234.567");
  });

  it("handles negatives and invalid", () => {
    expect(formatIntegerPtBr(-1500)).toBe("-1.500");
    expect(formatIntegerPtBr(Number.NaN)).toBe("—");
    expect(formatIntegerPtBr(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatMillionsShortPtBr", () => {
  it("uses comma decimal and M suffix (regression: stable SSR === client)", () => {
    expect(formatMillionsShortPtBr(19_900_000)).toBe("19,9M");
    expect(formatMillionsShortPtBr(32_400_000)).toBe("32,4M");
    expect(formatMillionsShortPtBr(1_000_000)).toBe("1,0M");
  });

  it("handles edge cases", () => {
    expect(formatMillionsShortPtBr(-1)).toBe("—");
    expect(formatMillionsShortPtBr(Number.NaN)).toBe("—");
  });
});

describe("formatDemoCreditsCompactPtBr", () => {
  it("abbreviates K and M consistently", () => {
    expect(formatDemoCreditsCompactPtBr(15_000)).toBe("15K");
    expect(formatDemoCreditsCompactPtBr(1_500_000)).toBe("1,5M");
  });
});
