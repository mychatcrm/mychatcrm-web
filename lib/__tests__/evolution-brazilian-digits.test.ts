import { describe, expect, it } from "vitest";
import {
  brazilianMobileAlternateVariant,
  ensureBrazilianMobileWhatsappDigits,
  isEvolutionDeliveredStatus,
  isEvolutionDeliveryErrorStatus,
  isEvolutionPendingStatus,
  isEvolutionSentAckStatus,
  pickEvolutionInstanceInfo,
  type EvolutionInstanceInfo,
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

  it("treats DELIVERY_ACK/READ/PLAYED as delivered, PENDING/SERVER_ACK as not", () => {
    expect(isEvolutionDeliveredStatus(3)).toBe(true);
    expect(isEvolutionDeliveredStatus(4)).toBe(true);
    expect(isEvolutionDeliveredStatus("DELIVERY_ACK")).toBe(true);
    expect(isEvolutionDeliveredStatus("READ")).toBe(true);
    expect(isEvolutionDeliveredStatus(2)).toBe(false);
    expect(isEvolutionDeliveredStatus("PENDING")).toBe(false);
    expect(isEvolutionDeliveredStatus("SERVER_ACK")).toBe(false);
  });

  it("recognizes PENDING as numeric 1 or string", () => {
    expect(isEvolutionPendingStatus(1)).toBe(true);
    expect(isEvolutionPendingStatus("PENDING")).toBe(true);
    expect(isEvolutionPendingStatus(2)).toBe(false);
    expect(isEvolutionSentAckStatus(2)).toBe(true);
    expect(isEvolutionSentAckStatus("SERVER_ACK")).toBe(true);
  });
});

describe("pickEvolutionInstanceInfo", () => {
  const list: EvolutionInstanceInfo[] = [
    { name: "mc-other", connectionStatus: "open", ownerJid: "5511999999999@s.whatsapp.net", profileName: "Other" },
    { name: "mc-system", connectionStatus: "open", ownerJid: "556282067910@s.whatsapp.net", profileName: "System" },
  ];

  it("selects the instance by name", () => {
    expect(pickEvolutionInstanceInfo(list, "mc-system")?.ownerJid).toBe("556282067910@s.whatsapp.net");
  });

  it("returns the only instance when there is a single one", () => {
    const single: EvolutionInstanceInfo[] = [
      { name: "weird-name", connectionStatus: "open", ownerJid: "5562000000000@s.whatsapp.net", profileName: null },
    ];
    expect(pickEvolutionInstanceInfo(single, "mc-system")?.ownerJid).toBe("5562000000000@s.whatsapp.net");
  });

  it("returns null when the named instance is missing among several", () => {
    expect(pickEvolutionInstanceInfo(list, "does-not-exist")).toBeNull();
  });
});
