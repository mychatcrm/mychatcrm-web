import { describe, expect, it } from "vitest";
import { getServerLeadUsageSnapshot } from "../dashboard-lead-usage";

/**
 * Regressão: o HTML inicial do contador de leads não pode depender de `localStorage`.
 * O snapshot de servidor deve ser 0/0 até a API hidratar no cliente.
 */
describe("getServerLeadUsageSnapshot", () => {
  it("returns zeros for any plan (stable SSR)", () => {
    const a = getServerLeadUsageSnapshot("escala");
    const b = getServerLeadUsageSnapshot("escala");
    expect(a).toEqual({ used: 0, bonus: 0 });
    expect(a).toEqual(b);
  });

  it("is identical across plans before API hydration", () => {
    expect(getServerLeadUsageSnapshot("equipa")).toEqual(getServerLeadUsageSnapshot("escala"));
  });
});
