import { describe, expect, it } from "vitest";
import { normalizeCheckoutPhone, validateCheckoutPhone } from "@/lib/checkout-phone";

describe("checkout phone validation", () => {
  it("normalizes common Brazilian phone formats to digits with country code", () => {
    expect(normalizeCheckoutPhone("(62) 99999-9999")).toBe("5562999999999");
    expect(normalizeCheckoutPhone("+55 62 99999-9999")).toBe("5562999999999");
    expect(normalizeCheckoutPhone("55 62 99999 9999")).toBe("5562999999999");
  });

  it("accepts valid checkout phones", () => {
    const result = validateCheckoutPhone("(62) 99999-9999");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.phone).toBe("5562999999999");
  });

  it("rejects empty or too-short phones", () => {
    expect(validateCheckoutPhone("").ok).toBe(false);
    expect(validateCheckoutPhone("12345").ok).toBe(false);
  });

  it("rejects 12 digit numbers that are missing the Brazil country code", () => {
    const result = validateCheckoutPhone("629935805744");

    expect(result.ok).toBe(false);
  });
});
