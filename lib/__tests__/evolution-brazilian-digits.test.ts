import { describe, expect, it } from "vitest";
import {
  brazilianMobileAlternateVariant,
  ensureBrazilianMobileWhatsappDigits,
} from "@/lib/integrations/evolution-api";

describe("Brazilian WhatsApp digit normalization", () => {
  it("adds the 9th digit for mobile numbers in the 12-digit format", () => {
    expect(ensureBrazilianMobileWhatsappDigits("556293580574")).toBe("5562993580574");
    expect(ensureBrazilianMobileWhatsappDigits("5562993580574")).toBe("5562993580574");
  });

  it("exposes alternate variants for Evolution number checks", () => {
    expect(brazilianMobileAlternateVariant("5562993580574")).toBe("556293580574");
    expect(brazilianMobileAlternateVariant("556293580574")).toBe("5562993580574");
  });
});
