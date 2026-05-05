import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sumOrganizationCostsUsd } from "@/lib/server/openai-org-costs-parse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../server/__fixtures__/openai-billing", name), "utf8")) as unknown;

describe("sumOrganizationCostsUsd", () => {
  it("sums amount.value across buckets", () => {
    const s = sumOrganizationCostsUsd(fx("organization-costs-sample.json"));
    expect(s).toBeCloseTo(3.75, 4);
  });
});
