import { describe, expect, it } from "vitest";
import {
  brazilianMobileAlternateVariant,
  ensureBrazilianMobileWhatsappDigits,
  isEvolutionDeliveryErrorStatus,
} from "@/lib/integrations/evolution-api";
import { extractMessageDeliveryUpdates } from "@/lib/integrations/evolution-webhook-parse";

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

describe("Evolution delivery helpers", () => {
  it("treats Baileys status 0 as delivery error", () => {
    expect(isEvolutionDeliveryErrorStatus(0)).toBe(true);
    expect(isEvolutionDeliveryErrorStatus(2)).toBe(false);
    expect(isEvolutionDeliveryErrorStatus("ERROR")).toBe(true);
  });

  it("parses MESSAGES_UPDATE delivery failures", () => {
    const updates = extractMessageDeliveryUpdates({
      data: [
        {
          key: { id: "ABC123", fromMe: true, remoteJid: "5562993580574@s.whatsapp.net" },
          update: { status: 0 },
        },
      ],
    });
    expect(updates).toEqual([
      { messageId: "ABC123", fromMe: true, status: 0 },
    ]);
  });
});
