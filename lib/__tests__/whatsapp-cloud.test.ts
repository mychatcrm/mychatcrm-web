import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseWhatsAppCloudInbound,
  parseWhatsAppCloudPayload,
  parseWhatsAppCloudStatuses,
  sendWhatsAppTemplateMessage,
} from "@/lib/integrations/whatsapp-cloud";

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

describe("parseWhatsAppCloudStatuses", () => {
  const wrapStatus = (status: Record<string, unknown>) => ({
    entry: [{ changes: [{ value: { statuses: [status] } }] }],
  });

  it("extracts the real failure reason from statuses[].errors[]", () => {
    const r = parseWhatsAppCloudStatuses(
      wrapStatus({
        id: "wamid.F1",
        status: "failed",
        recipient_id: "5562993580574",
        errors: [
          {
            code: 131047,
            title: "Re-engagement message",
            message: "Re-engagement message",
            error_data: { details: "Message failed to send because more than 24 hours have passed" },
          },
        ],
      }),
    );
    expect(r).toEqual([
      {
        id: "wamid.F1",
        status: "failed",
        recipientId: "5562993580574",
        errorCode: 131047,
        errorTitle: "Re-engagement message",
        errorDetail: "Message failed to send because more than 24 hours have passed",
      },
    ]);
  });

  it("returns null error fields for successful statuses", () => {
    const r = parseWhatsAppCloudStatuses(
      wrapStatus({ id: "wamid.D1", status: "delivered", recipient_id: "5562993580574" }),
    );
    expect(r).toEqual([
      { id: "wamid.D1", status: "delivered", recipientId: "5562993580574", errorCode: null, errorTitle: null, errorDetail: null },
    ]);
  });
});

describe("sendWhatsAppTemplateMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a template payload with body params", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: "wamid.T1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await sendWhatsAppTemplateMessage({
      toWaId: "5562993580574",
      templateName: "system_notification",
      languageCode: "pt_BR",
      bodyParams: ["Olá, seu WhatsApp caiu."],
      phoneNumberId: "PN123",
      accessToken: "token-abc",
    });

    expect(result).toEqual({ ok: true, status: 200, messageId: "wamid.T1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/PN123/messages");
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      to: "5562993580574",
      type: "template",
      template: {
        name: "system_notification",
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Olá, seu WhatsApp caiu." }] }],
      },
    });
  });

  it("omits components when there are no body params", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: "wamid.T2" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await sendWhatsAppTemplateMessage({
      toWaId: "5562993580574",
      templateName: "hello_world",
      languageCode: "en_US",
      phoneNumberId: "PN123",
      accessToken: "token-abc",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.template).toEqual({ name: "hello_world", language: { code: "en_US" } });
  });
});
