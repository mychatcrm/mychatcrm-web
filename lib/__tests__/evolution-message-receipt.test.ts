import { describe, expect, it } from "vitest";
import {
  extractEvolutionSendReceipt,
  mapEvolutionDeliveryStatus,
  shouldApplyCustomerDeliveryStatus,
} from "@/lib/integrations/evolution-message-receipt";

describe("Evolution customer delivery receipts", () => {
  it("keeps a successful HTTP send pending until WhatsApp acknowledges it", () => {
    expect(
      extractEvolutionSendReceipt({
        key: { id: "3EB0123", remoteJid: "556282194839@s.whatsapp.net" },
        status: "PENDING",
      }),
    ).toEqual({
      messageId: "3EB0123",
      remoteJid: "556282194839@s.whatsapp.net",
      providerStatus: "PENDING",
      deliveryStatus: "pending",
    });
  });

  it("maps every Baileys ACK without treating SERVER_ACK as delivery", () => {
    expect(mapEvolutionDeliveryStatus(1)).toBe("pending");
    expect(mapEvolutionDeliveryStatus(2)).toBe("sent");
    expect(mapEvolutionDeliveryStatus(3)).toBe("delivered");
    expect(mapEvolutionDeliveryStatus(4)).toBe("read");
    expect(mapEvolutionDeliveryStatus("PLAYED")).toBe("read");
    expect(mapEvolutionDeliveryStatus(0)).toBe("failed");
  });

  it("reads nested response variants", () => {
    expect(
      extractEvolutionSendReceipt({
        data: {
          key: { id: "NESTED", remoteJid: "123@lid" },
          status: 2,
        },
      }),
    ).toMatchObject({
      messageId: "NESTED",
      remoteJid: "123@lid",
      providerStatus: "2",
      deliveryStatus: "sent",
    });
  });

  it("never regresses a delivered/read message to pending or failed", () => {
    expect(shouldApplyCustomerDeliveryStatus("read", "pending")).toBe(false);
    expect(shouldApplyCustomerDeliveryStatus("delivered", "failed")).toBe(false);
    expect(shouldApplyCustomerDeliveryStatus("sent", "delivered")).toBe(true);
    expect(shouldApplyCustomerDeliveryStatus("pending", "failed")).toBe(true);
  });
});
