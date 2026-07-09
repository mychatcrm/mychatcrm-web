import { describe, expect, it } from "vitest";
import { normalizeActiveOfferFilter } from "@/lib/server/active-offers-filter";
import { ACTIVE_OFFER_MAX_LEADS } from "@/lib/active-offers-types";

describe("normalizeActiveOfferFilter", () => {
  it("applies defaults and caps limit", () => {
    const normalized = normalizeActiveOfferFilter({
      kanbanStages: ["perdido"],
      minDaysInactive: 365,
      limit: 99999,
    });

    expect(normalized.kanbanStages).toEqual(["perdido"]);
    expect(normalized.minDaysInactive).toBe(365);
    expect(normalized.includeUnassigned).toBe(true);
    expect(normalized.excludeOptOut).toBe(true);
    expect(normalized.limit).toBe(ACTIVE_OFFER_MAX_LEADS);
  });

  it("normalizes empty arrays", () => {
    const normalized = normalizeActiveOfferFilter({});
    expect(normalized.kanbanStages).toEqual([]);
    expect(normalized.ownerEmployeeIds).toEqual([]);
    expect(normalized.minDaysInactive).toBeNull();
  });
});
