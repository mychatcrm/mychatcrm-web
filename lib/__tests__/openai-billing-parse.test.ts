import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBillingUsageData, parseCreditGrantsFromData } from "@/lib/server/openai-billing-parse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../server/__fixtures__/openai-billing", name), "utf8")) as unknown;

describe("parseCreditGrantsFromData", () => {
  it("parses root totals", () => {
    const p = parseCreditGrantsFromData(fx("credit-grants-root.json"));
    expect(p.source).toBe("root");
    expect(p.totalGrantedUsd).toBe(100);
    expect(p.totalUsedUsd).toBe(40);
    expect(p.totalAvailableUsd).toBe(60);
  });

  it("aggregates data[] grants", () => {
    const p = parseCreditGrantsFromData(fx("credit-grants-data-list.json"));
    expect(p.source).toBe("aggregated");
    expect(p.totalGrantedUsd).toBe(100);
    expect(p.totalUsedUsd).toBe(15);
    expect(p.totalAvailableUsd).toBe(85);
  });

  it("aggregates grants.data", () => {
    const p = parseCreditGrantsFromData(fx("credit-grants-nested-grants.json"));
    expect(p.source).toBe("aggregated");
    expect(p.totalGrantedUsd).toBe(100);
    expect(p.totalUsedUsd).toBe(25);
    expect(p.totalAvailableUsd).toBe(75);
  });

  it("unwraps credit_summary", () => {
    const p = parseCreditGrantsFromData(fx("credit-summary-wrap.json"));
    expect(p.source).toBe("root");
    expect(p.totalAvailableUsd).toBe(12);
  });
});

describe("parseBillingUsageData", () => {
  it("normalizes large integer total_usage as cents", () => {
    const p = parseBillingUsageData(fx("usage-total-cents.json"));
    expect(p.unit).toBe("cents_normalized");
    expect(p.usd).toBeCloseTo(123.45, 4);
  });

  it("keeps fractional total_usage as USD", () => {
    const p = parseBillingUsageData(fx("usage-usd-float.json"));
    expect(p.unit).toBe("usd");
    expect(p.usd).toBeCloseTo(12.34, 4);
  });

  it("sums line_items cents", () => {
    const p = parseBillingUsageData(fx("usage-line-items-cents.json"));
    expect(p.unit).toBe("cents_normalized");
    expect(p.usd).toBeCloseTo(15, 4);
  });
});
