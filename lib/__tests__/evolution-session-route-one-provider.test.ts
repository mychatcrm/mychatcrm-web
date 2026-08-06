import { beforeEach, describe, expect, it, vi } from "vitest";

const getClientSessionFromCookies = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-server", () => ({ getClientSessionFromCookies }));

const getWhatsAppCloudConnection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({ getWhatsAppCloudConnection, deleteWhatsAppCloudConnection }));

const evolutionCreateInstance = vi.hoisted(() => vi.fn());
const evolutionConnectionState = vi.hoisted(() => vi.fn());
const evolutionFetchInstances = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/evolution-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/evolution-api")>();
  return {
    ...actual,
    isEvolutionApiConfigured: () => true,
    evolutionCreateInstance,
    evolutionConnectionState,
    evolutionFetchInstances,
  };
});

const getEvolutionInstanceByTenantSlot = vi.hoisted(() => vi.fn());
const upsertTenantEvolutionInstance = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/tenant-evolution-instance-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/tenant-evolution-instance-db")>();
  return { ...actual, getEvolutionInstanceByTenantSlot, upsertTenantEvolutionInstance };
});

const getExtraWhatsappSlots = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/whatsapp-extra-slots-db", () => ({ getExtraWhatsappSlots }));

const reconcileLiveEvolutionInstance = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/evolution-instance-reconciliation", () => ({ reconcileLiveEvolutionInstance }));

const assertEvolutionWaJidUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/whatsapp-number-guard", () => ({ assertEvolutionWaJidUnique }));

const setSlotActiveProvider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/whatsapp-slot-provider", () => ({ setSlotActiveProvider }));

const deleteWhatsAppCloudConnection = vi.hoisted(() => vi.fn());

const notifyTenantIntegrationConnected = vi.hoisted(() => vi.fn());
const notifyTenantIntegrationDisconnected = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/integration-disconnect-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/integration-disconnect-notifications")>();
  return { ...actual, notifyTenantIntegrationConnected, notifyTenantIntegrationDisconnected };
});

import { GET, POST } from "@/app/api/client/whatsapp/evolution/session/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/whatsapp/evolution/session", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeGetRequest(slotIndex: number) {
  return new Request(`https://example.test/api/client/whatsapp/evolution/session?slotIndex=${slotIndex}`);
}

const session = { tenantId: "t1", plan: "equipa", operationalLimits: { includedWhatsAppLines: 2 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EVOLUTION_WEBHOOK_SECRET", "test-secret");
  getClientSessionFromCookies.mockResolvedValue(session);
  getExtraWhatsappSlots.mockResolvedValue(0);
  getWhatsAppCloudConnection.mockResolvedValue(null);
  getEvolutionInstanceByTenantSlot.mockResolvedValue(null);
  evolutionConnectionState.mockResolvedValue({ ok: false, status: 0, error: "not mocked for this test" });
});

describe("POST /api/client/whatsapp/evolution/session — um método por vez", () => {
  it("recusa conectar QR quando a API Meta já está ativa na mesma linha", async () => {
    getWhatsAppCloudConnection.mockResolvedValue({ active: true });

    const res = await POST(makeRequest({ slotIndex: 0 }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("other_provider_connected");
    expect(evolutionCreateInstance).not.toHaveBeenCalled();
  });

  it("libera quando não há API Meta ativa na linha", async () => {
    getWhatsAppCloudConnection.mockResolvedValue(null);
    evolutionCreateInstance.mockResolvedValue({ ok: true, status: 200, data: {} });

    const res = await POST(makeRequest({ slotIndex: 0 }));

    expect(getWhatsAppCloudConnection).toHaveBeenCalledWith("t1", 0);
    const body = await res.json().catch(() => ({}));
    expect(body.code).not.toBe("other_provider_connected");
  });

  it("allowSwap pula a checagem — o fluxo guiado já desconectou o outro lado", async () => {
    getWhatsAppCloudConnection.mockResolvedValue({ active: true });
    evolutionCreateInstance.mockResolvedValue({ ok: true, status: 200, data: {} });

    const res = await POST(makeRequest({ slotIndex: 0, allowSwap: true }));

    expect(res.status).not.toBe(409);
    expect(getWhatsAppCloudConnection).not.toHaveBeenCalled();
  });

  it("API Meta ativa noutra linha não bloqueia esta", async () => {
    getWhatsAppCloudConnection.mockImplementation(async (_tenantId: string, slotIndex: number) =>
      slotIndex === 1 ? { active: true } : null,
    );
    evolutionCreateInstance.mockResolvedValue({ ok: true, status: 200, data: {} });

    const res = await POST(makeRequest({ slotIndex: 0 }));

    const body = await res.json().catch(() => ({}));
    expect(body.code).not.toBe("other_provider_connected");
  });
});

const baseRow = {
  id: "evo-1",
  tenant_id: "t1",
  slot_index: 0,
  instance_name: "inst-1",
  connection_state: "connecting",
  wa_jid: null as string | null,
  default_agent_id: null,
};

describe("GET /api/client/whatsapp/evolution/session — fecha a troca guiada quando o QR novo confirma", () => {
  beforeEach(() => {
    reconcileLiveEvolutionInstance.mockResolvedValue({ ok: false, instance: baseRow });
    evolutionConnectionState.mockResolvedValue({ ok: true, data: { state: "open" } });
    evolutionFetchInstances.mockResolvedValue({
      ok: true,
      data: [
        {
          name: "inst-1",
          connectionStatus: "open",
          ownerJid: "5562999999999@s.whatsapp.net",
          profileName: null,
        },
      ],
    });
    assertEvolutionWaJidUnique.mockResolvedValue({ ok: true });
    upsertTenantEvolutionInstance.mockResolvedValue(undefined);
    setSlotActiveProvider.mockResolvedValue({ switchedRuleIds: [], blockedRules: [] });
    deleteWhatsAppCloudConnection.mockResolvedValue(undefined);
    notifyTenantIntegrationConnected.mockResolvedValue(undefined);
    notifyTenantIntegrationDisconnected.mockResolvedValue(undefined);
  });

  it("QR confirmado com API Meta ainda ativa: reponta pro QR e desliga a API Meta", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue(baseRow);
    getWhatsAppCloudConnection.mockResolvedValue({ active: true });

    await GET(makeGetRequest(0));

    expect(setSlotActiveProvider).toHaveBeenCalledWith("t1", 0, "evolution");
    expect(deleteWhatsAppCloudConnection).toHaveBeenCalledWith("t1", 0);
  });

  it("QR confirmado sem API Meta ativa: não reponta nada (não havia troca de verdade)", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue(baseRow);
    getWhatsAppCloudConnection.mockResolvedValue(null);

    await GET(makeGetRequest(0));

    expect(setSlotActiveProvider).not.toHaveBeenCalled();
    expect(deleteWhatsAppCloudConnection).not.toHaveBeenCalled();
  });

  it("poll de uma sessão já confirmada antes (mesmo wa_jid) não reabre a limpeza", async () => {
    const alreadyConfirmedRow = { ...baseRow, wa_jid: "5562999999999@s.whatsapp.net", connection_state: "open" };
    getEvolutionInstanceByTenantSlot.mockResolvedValue(alreadyConfirmedRow);
    reconcileLiveEvolutionInstance.mockResolvedValue({ ok: false, instance: alreadyConfirmedRow });
    getWhatsAppCloudConnection.mockResolvedValue({ active: true });

    await GET(makeGetRequest(0));

    expect(setSlotActiveProvider).not.toHaveBeenCalled();
    expect(deleteWhatsAppCloudConnection).not.toHaveBeenCalled();
  });
});
