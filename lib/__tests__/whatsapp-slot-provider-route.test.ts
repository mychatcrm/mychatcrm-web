import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireActiveClientSessionMock,
  getExtraWhatsappSlotsMock,
  getEvolutionInstanceByTenantSlotMock,
  getWhatsAppCloudConnectionMock,
  setSlotActiveProviderMock,
} = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  getExtraWhatsappSlotsMock: vi.fn(),
  getEvolutionInstanceByTenantSlotMock: vi.fn(),
  getWhatsAppCloudConnectionMock: vi.fn(),
  setSlotActiveProviderMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({ requireActiveClientSession: requireActiveClientSessionMock }));
vi.mock("@/lib/server/whatsapp-extra-slots-db", () => ({ getExtraWhatsappSlots: getExtraWhatsappSlotsMock }));
vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByTenantSlot: getEvolutionInstanceByTenantSlotMock,
}));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({ getWhatsAppCloudConnection: getWhatsAppCloudConnectionMock }));
vi.mock("@/lib/server/whatsapp-slot-provider", () => ({ setSlotActiveProvider: setSlotActiveProviderMock }));

import { PATCH } from "@/app/api/client/whatsapp/slot-provider/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/whatsapp/slot-provider", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const session = { tenantId: "t1", plan: "pro", operationalLimits: { includedWhatsAppLines: 1 } };

describe("PATCH /api/client/whatsapp/slot-provider", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    getExtraWhatsappSlotsMock.mockReset();
    getEvolutionInstanceByTenantSlotMock.mockReset();
    getWhatsAppCloudConnectionMock.mockReset();
    setSlotActiveProviderMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session });
    getExtraWhatsappSlotsMock.mockResolvedValue(0);
  });

  it("rejects switching to cloud_api when the Meta side isn't actually connected", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ slotIndex: 0, provider: "cloud_api" }));

    expect(res.status).toBe(409);
    expect(setSlotActiveProviderMock).not.toHaveBeenCalled();
  });

  it("rejects switching to evolution when the QR side isn't open", async () => {
    getEvolutionInstanceByTenantSlotMock.mockResolvedValue({ connection_state: "close" });

    const res = await PATCH(makeRequest({ slotIndex: 0, provider: "evolution" }));

    expect(res.status).toBe(409);
    expect(setSlotActiveProviderMock).not.toHaveBeenCalled();
  });

  it("switches when the target side is genuinely connected", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue({ active: true });
    setSlotActiveProviderMock.mockResolvedValue({ switchedRuleIds: ["rule-1"], blockedRules: [] });

    const res = await PATCH(makeRequest({ slotIndex: 0, provider: "cloud_api" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, activeProvider: "cloud_api", blockedRules: [] });
    expect(setSlotActiveProviderMock).toHaveBeenCalledWith("t1", 0, "cloud_api");
  });

  it("surfaces blockedRules so the UI can warn about Lead Ads rules still needing a Meta template", async () => {
    getWhatsAppCloudConnectionMock.mockResolvedValue({ active: true });
    setSlotActiveProviderMock.mockResolvedValue({
      switchedRuleIds: [],
      blockedRules: [{ id: "rule-1", name: "[Recrutamento]" }],
    });

    const res = await PATCH(makeRequest({ slotIndex: 0, provider: "cloud_api" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      activeProvider: "cloud_api",
      blockedRules: [{ id: "rule-1", name: "[Recrutamento]" }],
    });
  });

  it("rejects an out-of-range slotIndex", async () => {
    const res = await PATCH(makeRequest({ slotIndex: 5, provider: "cloud_api" }));

    expect(res.status).toBe(400);
    expect(setSlotActiveProviderMock).not.toHaveBeenCalled();
  });
});
