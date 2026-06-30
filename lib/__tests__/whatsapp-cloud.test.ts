import { describe, expect, it } from "vitest";
import { parseWhatsAppCloudInbound, parseWhatsAppCloudPayload } from "@/lib/integrations/whatsapp-cloud";

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

describe("parseWhatsAppCloudInbound", () => {
  const wrap = (message: Record<string, unknown>) => ({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: "+55 62 8206-7910", phone_number_id: "PN999" },
              contacts: [{ wa_id: "5562999999999", profile: { name: "Lead" } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  });

  it("parses inbound text", () => {
    const r = parseWhatsAppCloudInbound(wrap({ type: "text", from: "5562999999999", id: "wamid.t", text: { body: "Oi" } }));
    expect(r).toMatchObject({ kind: "text", text: "Oi", phoneNumberId: "PN999", mediaId: null });
  });

  it("parses inbound audio with media id", () => {
    const r = parseWhatsAppCloudInbound(
      wrap({ type: "audio", from: "5562999999999", id: "wamid.a", audio: { id: "MEDIA1", mime_type: "audio/ogg" } }),
    );
    expect(r).toMatchObject({ kind: "audio", mediaId: "MEDIA1", mimeType: "audio/ogg" });
  });

  it("parses inbound image with caption", () => {
    const r = parseWhatsAppCloudInbound(
      wrap({ type: "image", from: "5562999999999", id: "wamid.i", image: { id: "MEDIA2", mime_type: "image/jpeg", caption: "olha" } }),
    );
    expect(r).toMatchObject({ kind: "image", mediaId: "MEDIA2", caption: "olha", text: "olha" });
  });
});
