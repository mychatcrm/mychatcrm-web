import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireActiveClientSessionMock,
  getExtraWhatsappSlotsMock,
  getWhatsAppCloudConnectionMock,
  sendWhatsAppTextMessageMock,
} = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  getExtraWhatsappSlotsMock: vi.fn(),
  getWhatsAppCloudConnectionMock: vi.fn(),
  sendWhatsAppTextMessageMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({ requireActiveClientSession: requireActiveClientSessionMock }));
vi.mock("@/lib/server/whatsapp-extra-slots-db", () => ({ getExtraWhatsappSlots: getExtraWhatsappSlotsMock }));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({ getWhatsAppCloudConnection: getWhatsAppCloudConnectionMock }));
vi.mock("@/lib/integrations/whatsapp-cloud", () => ({ sendWhatsAppTextMessage: sendWhatsAppTextMessageMock }));

import { POST } from "@/app/api/client/whatsapp-cloud/test-send/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/whatsapp-cloud/test-send", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const session = { tenantId: "t1", plan: "pro", operationalLimits: { includedWhatsAppLines: 1 } };

describe("POST /api/client/whatsapp-cloud/test-send", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    getExtraWhatsappSlotsMock.mockReset();
    getWhatsAppCloudConnectionMock.mockReset();
    sendWhatsAppTextMessageMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session });
    getExtraWhatsappSlotsMock.mockResolvedValue(0);
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
});
