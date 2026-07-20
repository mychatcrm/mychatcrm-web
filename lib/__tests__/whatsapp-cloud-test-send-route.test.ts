import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireActiveClientSessionMock,
  getExtraWhatsappSlotsMock,
  getWhatsAppCloudConnectionMock,
  sendWhatsAppTextMessageMock,
  sendWhatsAppTemplateMessageMock,
  listWhatsAppMessageTemplatesMock,
  checkWhatsAppCloudConnectionHealthMock,
} = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  getExtraWhatsappSlotsMock: vi.fn(),
  getWhatsAppCloudConnectionMock: vi.fn(),
  sendWhatsAppTextMessageMock: vi.fn(),
  sendWhatsAppTemplateMessageMock: vi.fn(),
  listWhatsAppMessageTemplatesMock: vi.fn(),
  checkWhatsAppCloudConnectionHealthMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({ requireActiveClientSession: requireActiveClientSessionMock }));
vi.mock("@/lib/server/whatsapp-extra-slots-db", () => ({ getExtraWhatsappSlots: getExtraWhatsappSlotsMock }));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({ getWhatsAppCloudConnection: getWhatsAppCloudConnectionMock }));

// classifyWhatsAppCloudSendError é uma função pura — mantém a implementação real
// (importActual) e só troca as chamadas de rede pelos mocks acima.
vi.mock("@/lib/integrations/whatsapp-cloud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/whatsapp-cloud")>(
    "@/lib/integrations/whatsapp-cloud",
  );
  return {
    ...actual,
    sendWhatsAppTextMessage: sendWhatsAppTextMessageMock,
    sendWhatsAppTemplateMessage: sendWhatsAppTemplateMessageMock,
    listWhatsAppMessageTemplates: listWhatsAppMessageTemplatesMock,
    checkWhatsAppCloudConnectionHealth: checkWhatsAppCloudConnectionHealthMock,
  };
});

import { POST } from "@/app/api/client/whatsapp-cloud/test-send/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/whatsapp-cloud/test-send", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const session = { tenantId: "t1", plan: "pro", operationalLimits: { includedWhatsAppLines: 1 } };

const HEALTHY = {
  ok: true as const,
  displayPhoneNumber: "+55 62 99999-9999",
  verifiedName: "Loja",
  qualityRating: "GREEN",
  messagingLimitTier: "TIER_1K",
};

describe("POST /api/client/whatsapp-cloud/test-send", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    getExtraWhatsappSlotsMock.mockReset();
    getWhatsAppCloudConnectionMock.mockReset();
    sendWhatsAppTextMessageMock.mockReset();
    sendWhatsAppTemplateMessageMock.mockReset();
    listWhatsAppMessageTemplatesMock.mockReset();
    checkWhatsAppCloudConnectionHealthMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session });
    getExtraWhatsappSlotsMock.mockResolvedValue(0);
    checkWhatsAppCloudConnectionHealthMock.mockResolvedValue(HEALTHY);
  });

  it("rejects an invalid phone number", async () => {
    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "123" }));

    expect(res.status).toBe(400);
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
  });

  it("regressão real: número digitado sem o DDI 55 é completado antes de enviar pela Meta", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue({
      active: true,
      access_token: "token-abc",
      phone_number_id: "PN123",
      waba_id: "WABA1",
    });
    sendWhatsAppTextMessageMock.mockResolvedValue({ ok: true, status: 200, messageId: "wamid.T1" });

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "62993580574" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, messageId: "wamid.T1", message: "Teste MyChatCRM — API Meta OK" });
    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ toWaId: "5562993580574" }),
    );
  });

  it("rejects when API Meta isn't connected on this slot", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue(null);

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "5562993580574" }));

    expect(res.status).toBe(409);
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
  });

  it("token inválido: curto-circuita antes de tentar enviar", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue({
      active: true,
      access_token: "token-dead",
      phone_number_id: "PN123",
      waba_id: "WABA1",
    });
    checkWhatsAppCloudConnectionHealthMock.mockResolvedValue({
      ok: false,
      code: "invalid_token",
      error: "Error validating access token",
    });

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "5562993580574" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("invalid_token");
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
  });

  it("fora da janela de 24h (131047): devolve templates aprovados como alternativa", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue({
      active: true,
      access_token: "token-abc",
      phone_number_id: "PN123",
      waba_id: "WABA1",
    });
    sendWhatsAppTextMessageMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: '{"error":{"message":"(#131047) Message failed to send because more than 24 hours have passed"}}',
    });
    listWhatsAppMessageTemplatesMock.mockResolvedValue([
      { name: "boas_vindas", status: "APPROVED", category: "UTILITY", language: "pt_BR", bodyText: "Olá {{1}}", bodyParamCount: 1 },
      { name: "rascunho", status: "PENDING", category: "UTILITY", language: "pt_BR", bodyText: "x", bodyParamCount: 0 },
    ]);

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "5562993580574" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("outside_24h_window");
    expect(body.availableTemplates).toEqual([{ name: "boas_vindas", language: "pt_BR", bodyParamCount: 1 }]);
  });

  it("envia via template aprovado quando o usuário escolhe um explicitamente", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue({
      active: true,
      access_token: "token-abc",
      phone_number_id: "PN123",
      waba_id: "WABA1",
    });
    listWhatsAppMessageTemplatesMock.mockResolvedValue([
      { name: "boas_vindas", status: "APPROVED", category: "UTILITY", language: "pt_BR", bodyText: "Olá {{1}}", bodyParamCount: 1 },
    ]);
    sendWhatsAppTemplateMessageMock.mockResolvedValue({ ok: true, status: 200, messageId: "wamid.T2" });

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "5562993580574", templateName: "boas_vindas" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe("wamid.T2");
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: "boas_vindas", languageCode: "pt_BR", bodyParams: ["Teste MyChatCRM — API Meta OK"] }),
    );
  });

  it("rejeita template inexistente ou não aprovado", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue({
      active: true,
      access_token: "token-abc",
      phone_number_id: "PN123",
      waba_id: "WABA1",
    });
    listWhatsAppMessageTemplatesMock.mockResolvedValue([]);

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "5562993580574", templateName: "inexistente" }));

    expect(res.status).toBe(400);
    expect(sendWhatsAppTemplateMessageMock).not.toHaveBeenCalled();
  });
});
