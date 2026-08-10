import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Caminho rápido do GET de sessão: uma linha saudável não pode mais pagar o
 * inventário COMPLETO da VPS nem repetir `connectionState`/`fetchInstances` a
 * cada poll. O que este teste protege é justamente isso — o número de idas à
 * VPS, que era o que deixava /dashboard/integracoes lenta.
 */

const getClientSessionFromCookies = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-server", () => ({ getClientSessionFromCookies }));

const getWhatsAppCloudConnection = vi.hoisted(() => vi.fn());
const deleteWhatsAppCloudConnection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  getWhatsAppCloudConnection,
  deleteWhatsAppCloudConnection,
}));

const evolutionConnectionState = vi.hoisted(() => vi.fn());
const evolutionFetchInstances = vi.hoisted(() => vi.fn());
const evolutionEnsureWebhook = vi.hoisted(() => vi.fn());
const evolutionEnsureClientInstanceSettings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/evolution-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/evolution-api")>();
  return {
    ...actual,
    isEvolutionApiConfigured: () => true,
    evolutionConnectionState,
    evolutionFetchInstances,
    evolutionEnsureWebhook,
    evolutionEnsureClientInstanceSettings,
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

const notifyTenantIntegrationConnected = vi.hoisted(() => vi.fn());
const notifyTenantIntegrationDisconnected = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/integration-disconnect-notifications", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/server/integration-disconnect-notifications")
  >();
  return { ...actual, notifyTenantIntegrationConnected, notifyTenantIntegrationDisconnected };
});

import { GET } from "@/app/api/client/whatsapp/evolution/session/route";

const INSTANCE = "mc-instancia-linha-0";
const JID = "5562999999999@s.whatsapp.net";

const session = { tenantId: "t1", plan: "equipa", operationalLimits: { includedWhatsAppLines: 2 } };

function makeGetRequest(slotIndex: number) {
  return new Request(
    `https://example.test/api/client/whatsapp/evolution/session?slotIndex=${slotIndex}`,
  );
}

/** Linha saudável: registro aberto no banco, com o mesmo jid que a VPS reporta. */
function healthyRow(instanceName = INSTANCE) {
  return {
    id: "conn-1",
    tenant_id: "t1",
    slot_index: 0,
    instance_name: instanceName,
    connection_state: "open",
    wa_jid: JID,
    default_agent_id: null,
    updated_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EVOLUTION_WEBHOOK_SECRET", "test-secret");
  getClientSessionFromCookies.mockResolvedValue(session);
  getExtraWhatsappSlots.mockResolvedValue(0);
  getWhatsAppCloudConnection.mockResolvedValue(null);
  upsertTenantEvolutionInstance.mockImplementation(async () => healthyRow());
  assertEvolutionWaJidUnique.mockResolvedValue({ ok: true });
  evolutionEnsureWebhook.mockResolvedValue({ reapplied: false, reapplyOk: true });
  evolutionEnsureClientInstanceSettings.mockResolvedValue({ reapplied: false, verified: true });
});

describe("GET /api/client/whatsapp/evolution/session — caminho rápido", () => {
  it("linha saudável não baixa o inventário completo nem reconcilia", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue(healthyRow());
    evolutionConnectionState.mockResolvedValue({ ok: true, status: 200, data: { state: "open" } });
    evolutionFetchInstances.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ name: INSTANCE, connectionStatus: "open", ownerJid: JID, profileName: null }],
    });

    const res = await GET(makeGetRequest(0));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.connectionState).toBe("open");
    expect(body.waJid).toBe(JID);

    // O ganho: nada de reconciliação, e o fetch sempre ESCOPADO na instância
    // (nunca o inventário inteiro, que é o `evolutionFetchInstances()` sem arg).
    expect(reconcileLiveEvolutionInstance).not.toHaveBeenCalled();
    expect(evolutionFetchInstances).toHaveBeenCalledTimes(1);
    expect(evolutionFetchInstances).toHaveBeenCalledWith(INSTANCE);
    expect(evolutionConnectionState).toHaveBeenCalledTimes(1);
  });

  it("instância ausente na VPS cai no caminho de recuperação (adoção de irmã)", async () => {
    const row = healthyRow();
    getEvolutionInstanceByTenantSlot.mockResolvedValue(row);
    // Fetch escopado não encontra nada → registro aponta pra instância morta.
    evolutionFetchInstances.mockResolvedValueOnce({ ok: true, status: 200, data: [] });
    reconcileLiveEvolutionInstance.mockResolvedValue({ ok: false, instance: row, reason: "connection_not_open" });
    evolutionConnectionState.mockResolvedValue({ ok: true, status: 200, data: { state: "close" } });

    const res = await GET(makeGetRequest(0));

    expect(res.status).toBe(200);
    expect(reconcileLiveEvolutionInstance).toHaveBeenCalledTimes(1);
  });

  it("falha de rede no fetch escopado também cai na recuperação, não assume saudável", async () => {
    const row = healthyRow();
    getEvolutionInstanceByTenantSlot.mockResolvedValue(row);
    evolutionFetchInstances.mockResolvedValueOnce({ ok: false, status: 0, error: "fetch failed" });
    reconcileLiveEvolutionInstance.mockResolvedValue({ ok: true, instance: row, adoptedSibling: false });
    evolutionConnectionState.mockResolvedValue({ ok: true, status: 200, data: { state: "close" } });

    await GET(makeGetRequest(0));

    expect(reconcileLiveEvolutionInstance).toHaveBeenCalledTimes(1);
  });

  it("sessão zumbi (open sem ownerJid) continua virando close", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue(healthyRow());
    evolutionConnectionState.mockResolvedValue({ ok: true, status: 200, data: { state: "open" } });
    evolutionFetchInstances.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ name: INSTANCE, connectionStatus: "open", ownerJid: null, profileName: null }],
    });

    const res = await GET(makeGetRequest(0));
    const body = await res.json();

    expect(body.connectionState).not.toBe("open");
  });

  it("checagem de deriva de config não repete no poll seguinte da mesma instância", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue(healthyRow());
    evolutionConnectionState.mockResolvedValue({ ok: true, status: 200, data: { state: "open" } });
    evolutionFetchInstances.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ name: INSTANCE, connectionStatus: "open", ownerJid: JID, profileName: null }],
    });

    await GET(makeGetRequest(0));
    const afterFirstPoll = evolutionEnsureWebhook.mock.calls.length;

    await GET(makeGetRequest(0));

    // Dentro da janela de throttle, o segundo poll não re-checa a config.
    expect(evolutionEnsureWebhook.mock.calls.length).toBe(afterFirstPoll);
  });
});
