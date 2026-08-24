import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkWhatsAppCloudConnectionHealth,
  classifyWhatsAppCloudSendError,
  createWhatsAppMessageTemplate,
  fetchWhatsAppMessageTemplateStatus,
  parseWhatsAppCloudInbound,
  parseWhatsAppCloudPayload,
  parseWhatsAppCloudStatuses,
  sendWhatsAppMediaMessage,
  sendWhatsAppTemplateMessage,
  uploadWhatsAppCloudMedia,
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

  it("regressão real: mensagem multi-linha (2026-07-19, erro 132018) vira parâmetro de uma linha só", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: "wamid.T3" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const multilineMessage = [
      "Código MyChatCRM: 123456.",
      "Use este código em Configurações para confirmar seu telefone.",
      "Ele    expira em 10 minutos.",
    ].join("\n");

    await sendWhatsAppTemplateMessage({
      toWaId: "5562993580574",
      templateName: "mychatcrm_agenda_notification_v1",
      languageCode: "pt_BR",
      bodyParams: [multilineMessage],
      phoneNumberId: "PN123",
      accessToken: "token-abc",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const sentText = body.template.components[0].parameters[0].text as string;
    expect(sentText).not.toMatch(/[\n\t]/);
    expect(sentText).not.toMatch(/ {5,}/);
    expect(sentText).toBe(
      "Código MyChatCRM: 123456. Use este código em Configurações para confirmar seu telefone. Ele expira em 10 minutos.",
    );
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

describe("WhatsApp Cloud media", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a document through the exact connection without putting the token in the URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ messages: [{ id: "wamid.media" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const result = await sendWhatsAppMediaMessage({
      toWaId: "+1 (212) 555-0100",
      kind: "document",
      phoneNumberId: "PN-EXACT",
      accessToken: "secret-token",
      link: "https://cdn.example/document.pdf",
      filename: "document.pdf",
    });

    expect(result).toEqual({ ok: true, status: 200, messageId: "wamid.media" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/PN-EXACT/messages");
    expect(url).not.toContain("secret-token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: "12125550100",
      type: "document",
      document: { link: "https://cdn.example/document.pdf", filename: "document.pdf" },
    });
  });

  it("uploads generated audio and returns the provider media id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: "media-id-1" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const result = await uploadWhatsAppCloudMedia({
      phoneNumberId: "PN-EXACT",
      accessToken: "secret-token",
      buffer: Buffer.from("mp3"),
      mimeType: "audio/mpeg",
      filename: "reply.mp3",
    });

    expect(result).toEqual({ ok: true, status: 200, mediaId: "media-id-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/PN-EXACT/media");
    expect(url).not.toContain("secret-token");
    expect(init.body).toBeInstanceOf(FormData);
  });
});

describe("fetchWhatsAppMessageTemplateStatus", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an approved template as found", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [{ name: "system_notification", status: "APPROVED", category: "UTILITY" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await fetchWhatsAppMessageTemplateStatus({
      wabaId: "WABA1",
      templateName: "system_notification",
      accessToken: "token-abc",
    });

    expect(result).toEqual({ found: true, status: "APPROVED", category: "UTILITY" });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/WABA1/message_templates");
    expect(url).toContain("name=system_notification");
  });

  it("reports a pending template as found", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [{ name: "system_notification", status: "PENDING", category: "UTILITY" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await fetchWhatsAppMessageTemplateStatus({
      wabaId: "WABA1",
      templateName: "system_notification",
      accessToken: "token-abc",
    });

    expect(result).toEqual({ found: true, status: "PENDING", category: "UTILITY" });
  });

  it("reports a rejected template as found", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [{ name: "system_notification", status: "REJECTED", category: "UTILITY" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await fetchWhatsAppMessageTemplateStatus({
      wabaId: "WABA1",
      templateName: "system_notification",
      accessToken: "token-abc",
    });

    expect(result).toEqual({ found: true, status: "REJECTED", category: "UTILITY" });
  });

  it("reports not found when the name does not match any template", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await fetchWhatsAppMessageTemplateStatus({
      wabaId: "WABA1",
      templateName: "nome_errado",
      accessToken: "token-abc",
    });

    expect(result).toEqual({ found: false, status: null, category: null });
  });

  it("reports not found when the Graph API call fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));

    const result = await fetchWhatsAppMessageTemplateStatus({
      wabaId: "WABA1",
      templateName: "system_notification",
      accessToken: "token-invalido",
    });

    expect(result).toEqual({ found: false, status: null, category: null });
  });
});

describe("createWhatsAppMessageTemplate", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits a utility template with static context and one dynamic body parameter", async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: "template-1", status: "PENDING" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const result = await createWhatsAppMessageTemplate({
      wabaId: "WABA1",
      accessToken: "token-abc",
      templateName: "mychatcrm_agenda_notification_v1",
    });

    expect(result).toMatchObject({ ok: true, templateStatus: "PENDING", id: "template-1" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      name: "mychatcrm_agenda_notification_v1",
      language: "pt_BR",
      category: "UTILITY",
    });
    expect(body).not.toHaveProperty("allow_category_change");
    expect(body.components[0].text).toContain("{{1}}");
    expect(body.components[0].text).toContain("MyChatCRM");
    expect(body.components[0].text.trim()).not.toMatch(/{{1}}$/);
  });

  it("returns the actionable Meta error fields without exposing credentials", async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        error: {
          message: "Invalid parameter",
          code: 100,
          error_subcode: 2388093,
          error_user_title: "Parâmetro de exemplo inválido",
          error_user_msg: "O exemplo do corpo deve corresponder às variáveis.",
          error_data: { details: "body_text[0]" },
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));

    const result = await createWhatsAppMessageTemplate({
      wabaId: "WABA1",
      accessToken: "token-secreto",
      templateName: "mychatcrm_agenda_notification_v1",
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "Parâmetro de exemplo inválido — O exemplo do corpo deve corresponder às variáveis. — body_text[0]",
      metaError: {
        code: 100,
        subcode: 2388093,
      },
    });
    expect(result.error).not.toContain("token-secreto");
  });
});

describe("classifyWhatsAppCloudSendError", () => {
  it("classifies 131047 as outside the 24h window", () => {
    expect(classifyWhatsAppCloudSendError('{"error":{"code":131047,"message":"outside allowed window"}}')).toBe(
      "outside_24h_window",
    );
  });

  it("classifies 190 / expired session as an invalid token", () => {
    expect(classifyWhatsAppCloudSendError('{"error":{"code":190,"message":"Error validating access token"}}')).toBe(
      "invalid_token",
    );
    expect(classifyWhatsAppCloudSendError("Session has expired on Monday")).toBe("invalid_token");
  });

  it("falls back to other for unrecognized errors", () => {
    expect(classifyWhatsAppCloudSendError("some unrelated network error")).toBe("other");
    expect(classifyWhatsAppCloudSendError(undefined)).toBe("other");
  });
});

describe("checkWhatsAppCloudConnectionHealth", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a healthy connection", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          display_phone_number: "+55 62 99999-9999",
          verified_name: "Loja",
          quality_rating: "GREEN",
          messaging_limit_tier: "TIER_1K",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await checkWhatsAppCloudConnectionHealth({ phoneNumberId: "PN123", accessToken: "token-abc" });

    expect(result).toEqual({
      ok: true,
      displayPhoneNumber: "+55 62 99999-9999",
      verifiedName: "Loja",
      qualityRating: "GREEN",
      messagingLimitTier: "TIER_1K",
    });
  });

  it("classifies a 401 response as an invalid token", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Error validating access token", code: 190 } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await checkWhatsAppCloudConnectionHealth({ phoneNumberId: "PN123", accessToken: "token-morto" });

    expect(result).toEqual({ ok: false, code: "invalid_token", error: "Error validating access token" });
  });

  it("classifies a network failure as unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const result = await checkWhatsAppCloudConnectionHealth({ phoneNumberId: "PN123", accessToken: "token-abc" });

    expect(result).toEqual({ ok: false, code: "unreachable", error: "network down" });
  });
});
