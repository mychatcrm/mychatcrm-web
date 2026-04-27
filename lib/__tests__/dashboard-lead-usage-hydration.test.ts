import { describe, expect, it } from "vitest";
import { getServerLeadUsageSnapshot, planMonthlyLeadAllowance } from "../dashboard-lead-usage";

/**
 * Regressão: o HTML inicial do contador de leads não pode depender de `localStorage`.
 * O snapshot de servidor/hidratação deve ser reprodutível só com o plano.
 */
describe("getServerLeadUsageSnapshot", () => {
  it("returns stable bonus and deterministic used for the same plan", () => {
    const a = getServerLeadUsageSnapshot("escala");
    const b = getServerLeadUsageSnapshot("escala");
    expect(a).toEqual(b);
    expect(a.bonus).toBe(0);
    expect(a.used).toBeLessThanOrEqual(planMonthlyLeadAllowance("escala"));
  });

  it("differs predictably between plans", () => {
    const equipa = getServerLeadUsageSnapshot("equipa");
    const escala = getServerLeadUsageSnapshot("escala");
    expect(equipa.used).not.toEqual(escala.used);
  });
});
