import { describe, expect, it } from "vitest";
import { parseWhatsAppCloudPayload } from "@/lib/integrations/whatsapp-cloud";

describe("parseWhatsAppCloudPayload", () => {
  it("extracts first inbound text", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: "+55 11 3333-4444", phone_number_id: "PN123" },
                contacts: [{ wa_id: "5511999999999", profile: { name: "Cliente Teste" } }],
                messages: [{ type: "text", from: "5511999999999", id: "wamid.x", text: { body: "Olá" } }],
              },
            },
          ],
        },
      ],
    };
    expect(parseWhatsAppCloudPayload(body)).toEqual({
      fromWaId: "5511999999999",
      phoneNumberId: "PN123",
      displayPhoneNumber: "+55 11 3333-4444",
      text: "Olá",
      messageId: "wamid.x",
      contactName: "Cliente Teste",
    });
  });

  it("returns null when no text message", () => {
    expect(parseWhatsAppCloudPayload({ entry: [] })).toBeNull();
  });
});
