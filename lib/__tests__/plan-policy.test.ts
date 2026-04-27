import { describe, expect, it } from "vitest";
import { getPlanPolicy, maxCollaboratorsTotal, normalizeToPlan, PLAN_POLICY_VERSION } from "../plan-policy";

describe("plan-policy", () => {
  it("exposes a version for billing snapshots", () => {
    expect(PLAN_POLICY_VERSION).toBe(1);
  });

  it("normalizes legacy slugs", () => {
    expect(normalizeToPlan("profissional")).toBe("equipa");
    expect(normalizeToPlan("master")).toBe("escala");
    expect(normalizeToPlan("unknown-plan")).toBe("equipa");
  });

  it("keeps solo / equipa / escala / enterprise caps aligned with commercial copy", () => {
    expect(getPlanPolicy("solo").monthlyAttendedLeadsCap).toBe(500);
    expect(getPlanPolicy("solo").includedAgents).toBe(2);
    expect(getPlanPolicy("equipa").monthlyAttendedLeadsCap).toBe(5000);
    expect(getPlanPolicy("escala").monthlyAttendedLeadsCap).toBe(15000);
    expect(getPlanPolicy("enterprise").maxSalesFunnels).toBe(100);
    expect(maxCollaboratorsTotal(getPlanPolicy("solo"))).toBe(0);
    expect(maxCollaboratorsTotal(getPlanPolicy("equipa"))).toBe(34);
  });
});
