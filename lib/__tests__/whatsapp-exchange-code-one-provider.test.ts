import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActiveClientSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/client-session-guard", () => ({ requireActiveClientSession }));

const getEvolutionInstanceByTenantSlot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/tenant-evolution-instance-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/tenant-evolution-instance-db")>();
  return { ...actual, getEvolutionInstanceByTenantSlot };
});

const getExtraWhatsappSlots = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/whatsapp-extra-slots-db", () => ({ getExtraWhatsappSlots }));

const lookupWhatsAppCloudConnectionByPhoneNumberId = vi.hoisted(() => vi.fn());
const upsertWhatsAppCloudConnection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  lookupWhatsAppCloudConnectionByPhoneNumberId,
  upsertWhatsAppCloudConnection,
}));

const setSlotActiveProvider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/whatsapp-slot-provider", () => ({ setSlotActiveProvider }));

const removeEvolutionSlotSafely = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/evolution-slot-lifecycle", () => ({ removeEvolutionSlotSafely }));

import { POST } from "@/app/api/client/whatsapp-cloud/exchange-code/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/whatsapp-cloud/exchange-code", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const session = { tenantId: "t1", plan: "equipa", operationalLimits: { includedWhatsAppLines: 2 } };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("META_APP_ID", "app-id");
  vi.stubEnv("META_APP_SECRET", "app-secret");
  requireActiveClientSession.mockResolvedValue({ ok: true, session });
  getExtraWhatsappSlots.mockResolvedValue(0);
  getEvolutionInstanceByTenantSlot.mockResolvedValue(null);
  lookupWhatsAppCloudConnectionByPhoneNumberId.mockResolvedValue(null);
  upsertWhatsAppCloudConnection.mockResolvedValue({ error: null });
  setSlotActiveProvider.mockResolvedValue({ switchedRuleIds: [], blockedRules: [] });
  removeEvolutionSlotSafely.mockResolvedValue({ state: "complete", operation: "deleting", finalized: true });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ json: async () => ({ access_token: "tok" }) });
});

describe("POST /api/client/whatsapp-cloud/exchange-code — um método por vez", () => {
  it("recusa conectar API Meta quando o QR já está aberto na mesma linha (sem allowSwap)", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ connection_state: "open" });

    const res = await POST(makeRequest({ code: "c", waba_id: "w", phone_number_id: "123", slotIndex: 0 }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("other_provider_connected");
    // A checagem roda antes de qualquer troca de token com a Graph.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("libera quando o QR não está aberto na linha", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ connection_state: "close" });

    const res = await POST(makeRequest({ code: "c", waba_id: "w", phone_number_id: "123", slotIndex: 0 }));

    const body = await res.json().catch(() => ({}));
    expect(body.code).not.toBe("other_provider_connected");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("QR aberto noutra linha não bloqueia esta", async () => {
    getEvolutionInstanceByTenantSlot.mockImplementation(async (_tenantId: string, slotIndex: number) =>
      slotIndex === 1 ? { connection_state: "open" } : { connection_state: "close" },
    );

    const res = await POST(makeRequest({ code: "c", waba_id: "w", phone_number_id: "123", slotIndex: 0 }));

    const body = await res.json().catch(() => ({}));
    expect(body.code).not.toBe("other_provider_connected");
  });
});

describe("POST /api/client/whatsapp-cloud/exchange-code — troca guiada (allowSwap)", () => {
  it("allowSwap pula a checagem de bloqueio pré-conexão", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ connection_state: "close" });

    const res = await POST(
      makeRequest({ code: "c", waba_id: "w", phone_number_id: "123", slotIndex: 0, allowSwap: true }),
    );

    const body = await res.json().catch(() => ({}));
    expect(body.code).not.toBe("other_provider_connected");
  });

  it("com allowSwap e QR ainda aberto: reponta as regras pra Cloud e desliga o QR", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ connection_state: "open" });

    await POST(makeRequest({ code: "c", waba_id: "w", phone_number_id: "123", slotIndex: 0, allowSwap: true }));

    expect(setSlotActiveProvider).toHaveBeenCalledWith("t1", 0, "cloud_api");
    expect(removeEvolutionSlotSafely).toHaveBeenCalledWith({ tenantId: "t1", slotIndex: 0, mode: "deleting" });
  });

  it("com allowSwap mas QR já fechado: não reponta nada (não havia troca de verdade)", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ connection_state: "close" });

    await POST(makeRequest({ code: "c", waba_id: "w", phone_number_id: "123", slotIndex: 0, allowSwap: true }));

    expect(setSlotActiveProvider).not.toHaveBeenCalled();
    expect(removeEvolutionSlotSafely).not.toHaveBeenCalled();
  });

  it("sem allowSwap, mesmo com QR aberto (bloqueado antes), nunca chega a repontar", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ connection_state: "open" });

    await POST(makeRequest({ code: "c", waba_id: "w", phone_number_id: "123", slotIndex: 0 }));

    expect(setSlotActiveProvider).not.toHaveBeenCalled();
    expect(removeEvolutionSlotSafely).not.toHaveBeenCalled();
  });
});
