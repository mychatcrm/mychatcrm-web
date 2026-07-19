import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireActiveClientSessionMock,
  getExtraWhatsappSlotsMock,
  getEvolutionInstanceByTenantSlotMock,
  sendEvolutionTextWithConnectionRecoveryMock,
} = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  getExtraWhatsappSlotsMock: vi.fn(),
  getEvolutionInstanceByTenantSlotMock: vi.fn(),
  sendEvolutionTextWithConnectionRecoveryMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({ requireActiveClientSession: requireActiveClientSessionMock }));
vi.mock("@/lib/server/whatsapp-extra-slots-db", () => ({ getExtraWhatsappSlots: getExtraWhatsappSlotsMock }));
vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByTenantSlot: getEvolutionInstanceByTenantSlotMock,
}));
vi.mock("@/lib/server/evolution-send-recovery", () => ({
  sendEvolutionTextWithConnectionRecovery: sendEvolutionTextWithConnectionRecoveryMock,
}));

import { POST } from "@/app/api/client/whatsapp/evolution/test-send/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/whatsapp/evolution/test-send", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const session = { tenantId: "t1", plan: "pro", operationalLimits: { includedWhatsAppLines: 1 } };

describe("POST /api/client/whatsapp/evolution/test-send", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    getExtraWhatsappSlotsMock.mockReset();
    getEvolutionInstanceByTenantSlotMock.mockReset();
    sendEvolutionTextWithConnectionRecoveryMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session });
    getExtraWhatsappSlotsMock.mockResolvedValue(0);
  });

  it("rejects a seller (no permission to test WhatsApp sends)", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: true,
      session: { ...session, employeeId: "emp-1" },
    });

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "5562999999999" }));

    expect(res.status).toBe(403);
    expect(sendEvolutionTextWithConnectionRecoveryMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range slotIndex", async () => {
    const res = await POST(makeRequest({ slotIndex: 5, toNumber: "5562999999999" }));

    expect(res.status).toBe(400);
    expect(sendEvolutionTextWithConnectionRecoveryMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone number", async () => {
    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "123" }));

    expect(res.status).toBe(400);
    expect(sendEvolutionTextWithConnectionRecoveryMock).not.toHaveBeenCalled();
  });

  it("rejects when the QR/Evolution side isn't connected", async () => {
    getEvolutionInstanceByTenantSlotMock.mockResolvedValue({ connection_state: "close", instance_name: "inst-1" });

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "5562999999999" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("QR Code não está conectado");
    expect(sendEvolutionTextWithConnectionRecoveryMock).not.toHaveBeenCalled();
  });

  it("sends the free-text test message through the connected instance", async () => {
    getEvolutionInstanceByTenantSlotMock.mockResolvedValue({ connection_state: "open", instance_name: "inst-1" });
    sendEvolutionTextWithConnectionRecoveryMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "+55 (62) 99999-9999" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, message: "Teste MyChatCRM — QR Code OK" });
    expect(sendEvolutionTextWithConnectionRecoveryMock).toHaveBeenCalledWith({
      instanceName: "inst-1",
      number: "5562999999999",
      text: "Teste MyChatCRM — QR Code OK",
      resolveRecipient: true,
    });
  });

  it("regressão real: número digitado sem o DDI 55 é completado antes de checar/enviar", async () => {
    getEvolutionInstanceByTenantSlotMock.mockResolvedValue({ connection_state: "open", instance_name: "inst-1" });
    sendEvolutionTextWithConnectionRecoveryMock.mockResolvedValue({ ok: true, status: 200 });

    // Renato digitou só DDD + número (sem "55") — antes do fix isso ia direto
    // pro check da Evolution como está, que rejeitava como "não encontrado"
    // mesmo sendo um número real com WhatsApp.
    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "62993580574" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, message: "Teste MyChatCRM — QR Code OK" });
    expect(sendEvolutionTextWithConnectionRecoveryMock).toHaveBeenCalledWith(
      expect.objectContaining({ number: "5562993580574" }),
    );
  });

  it("surfaces a friendly error when the recipient has no WhatsApp", async () => {
    getEvolutionInstanceByTenantSlotMock.mockResolvedValue({ connection_state: "open", instance_name: "inst-1" });
    sendEvolutionTextWithConnectionRecoveryMock.mockResolvedValue({
      ok: false,
      status: 422,
      error: "evolution_recipient_not_found",
    });

    const res = await POST(makeRequest({ slotIndex: 0, toNumber: "5562999999999" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain("não tem WhatsApp");
  });
});
