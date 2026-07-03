import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAdminSessionFromCookies = vi.hoisted(() => vi.fn());
const hasAdminAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({
  getAdminSessionFromCookies,
  hasAdminAccess,
}));

const resetSystemAgentEvolutionBinding = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/system-agent", () => ({
  SYSTEM_AGENT_ID: "mychatcrm-system-agent",
  SYSTEM_SLOT_INDEX: 0,
  SYSTEM_TENANT_ID: "tenant-system-internal",
  resetSystemAgentEvolutionBinding,
}));

const evolutionCreateInstance = vi.hoisted(() => vi.fn());
const evolutionSetWebhook = vi.hoisted(() => vi.fn());
const evolutionGetInstancePresence = vi.hoisted(() => vi.fn());
const evolutionConnectionState = vi.hoisted(() => vi.fn());
const evolutionInstanceConnect = vi.hoisted(() => vi.fn());
const evolutionRemoveInstanceCompletely = vi.hoisted(() => vi.fn());
const evolutionFetchInstances = vi.hoisted(() => vi.fn());
const checkEvolutionSessionAlive = vi.hoisted(() => vi.fn());

vi.mock("@/lib/integrations/evolution-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/evolution-api")>();
  return {
    ...actual,
    isEvolutionApiConfigured: () => true,
    evolutionCreateInstance,
    evolutionSetWebhook,
    evolutionGetInstancePresence,
    evolutionConnectionState,
    evolutionInstanceConnect,
    evolutionRemoveInstanceCompletely,
    evolutionFetchInstances,
    checkEvolutionSessionAlive,
  };
});

const getEvolutionInstanceByTenantSlot = vi.hoisted(() => vi.fn());
const reserveTenantEvolutionInstance = vi.hoisted(() => vi.fn());
const finalizeTenantEvolutionInstanceReservation = vi.hoisted(() => vi.fn());
const deleteTenantEvolutionInstanceRowIfName = vi.hoisted(() => vi.fn());
const updateEvolutionInstanceStateByName = vi.hoisted(() => vi.fn());
const upsertTenantEvolutionInstance = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByTenantSlot,
  reserveTenantEvolutionInstance,
  finalizeTenantEvolutionInstanceReservation,
  deleteTenantEvolutionInstanceRowIfName,
  updateEvolutionInstanceStateByName,
  upsertTenantEvolutionInstance,
}));

import { DELETE, GET, POST } from "@/app/api/admin/system-agent/evolution/session/route";

function resetSuccess() {
  return {
    inventoryVerified: true,
    removedInstances: [],
    failedInstances: [],
    remainingInstances: [],
    error: null,
    currentInstance: null,
    currentInstanceRemoved: true,
    databaseBindingCleared: true,
  };
}

function row(instanceName: string, connectionState = "provisioning") {
  return {
    id: "row-1",
    tenant_id: "tenant-system-internal",
    slot_index: 0,
    instance_name: instanceName,
    connection_state: connectionState,
    wa_jid: null,
    default_agent_id: "mychatcrm-system-agent",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("system agent Evolution session transaction", () => {
  const originalSecret = process.env.EVOLUTION_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVOLUTION_WEBHOOK_SECRET = "test-webhook-secret";
    getAdminSessionFromCookies.mockResolvedValue({ id: "admin" });
    hasAdminAccess.mockReturnValue(true);
    getEvolutionInstanceByTenantSlot.mockResolvedValue(null);
    resetSystemAgentEvolutionBinding.mockResolvedValue(resetSuccess());
    evolutionCreateInstance.mockResolvedValue({ ok: true, status: 201, data: {} });
    evolutionSetWebhook.mockResolvedValue({ ok: true, status: 200, data: {} });
    evolutionGetInstancePresence.mockResolvedValue({ state: "present", status: 200, error: null });
    evolutionConnectionState.mockResolvedValue({
      ok: true,
      status: 200,
      data: { instance: { state: "close" } },
    });
    evolutionFetchInstances.mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });
    checkEvolutionSessionAlive.mockResolvedValue(false);
    evolutionInstanceConnect.mockResolvedValue({
      ok: true,
      status: 200,
      data: { pairingCode: "12345678" },
    });
    evolutionRemoveInstanceCompletely.mockResolvedValue({
      ok: true,
      deleted: true,
      verifiedAbsent: true,
      presence: "absent",
      error: null,
      status: 200,
    });
    deleteTenantEvolutionInstanceRowIfName.mockResolvedValue(true);
    updateEvolutionInstanceStateByName.mockResolvedValue(undefined);
    finalizeTenantEvolutionInstanceReservation.mockImplementation(async (params) =>
      row(params.instanceName, params.connectionState),
    );
  });

  afterEach(() => {
    process.env.EVOLUTION_WEBHOOK_SECRET = originalSecret;
  });

  it("does not create an instance when strict cleanup cannot prove absence", async () => {
    resetSystemAgentEvolutionBinding.mockResolvedValue({
      ...resetSuccess(),
      currentInstance: "mc-old",
      currentInstanceRemoved: false,
      databaseBindingCleared: false,
      failedInstances: [
        {
          instanceName: "mc-old",
          presence: "present",
          status: 400,
          error: "Bad Request",
        },
      ],
      error: "one_or_more_system_instances_remain",
    });

    const response = await POST(new Request("https://www.mychatcrm.com.br/api/admin/system-agent/evolution/session", {
      method: "POST",
    }));

    expect(response.status).toBe(409);
    expect(evolutionCreateInstance).not.toHaveBeenCalled();
    expect(reserveTenantEvolutionInstance).not.toHaveBeenCalled();
  });

  it("allows only one remote create when two requests compete for the same slot", async () => {
    let slotReserved = false;
    let reservedName = "";
    reserveTenantEvolutionInstance.mockImplementation(async (params) => {
      if (slotReserved) return { reserved: false, row: row(reservedName) };
      slotReserved = true;
      reservedName = params.instanceName;
      return { reserved: true, row: row(params.instanceName) };
    });

    const request = () =>
      POST(new Request("https://www.mychatcrm.com.br/api/admin/system-agent/evolution/session", {
        method: "POST",
      }));
    const responses = await Promise.all([request(), request()]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(evolutionCreateInstance).toHaveBeenCalledTimes(1);
    expect(evolutionCreateInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: expect.any(String),
        settings: {
          groupsIgnore: true,
          readMessages: false,
          readStatus: false,
        },
      }),
    );
    expect(evolutionCreateInstance.mock.calls[0]?.[0]).not.toHaveProperty("webhookUrl");
    expect(evolutionSetWebhook).toHaveBeenCalledTimes(1);
  });

  it("removes the new instance and reservation when webhook configuration fails", async () => {
    reserveTenantEvolutionInstance.mockImplementation(async (params) => ({
      reserved: true,
      row: row(params.instanceName),
    }));
    evolutionSetWebhook.mockResolvedValue({
      ok: false,
      status: 500,
      data: null,
      error: "webhook failed",
    });

    const response = await POST(new Request("https://www.mychatcrm.com.br/api/admin/system-agent/evolution/session", {
      method: "POST",
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ phase: "webhook" });
    expect(evolutionRemoveInstanceCompletely).toHaveBeenCalledTimes(1);
    expect(deleteTenantEvolutionInstanceRowIfName).toHaveBeenCalledTimes(1);
    expect(finalizeTenantEvolutionInstanceReservation).not.toHaveBeenCalled();
  });

  it("returns a visible error when an existing session cannot refresh its QR", async () => {
    const existing = row("mc-existing", "close");
    getEvolutionInstanceByTenantSlot.mockResolvedValue(existing);
    evolutionFetchInstances.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ name: existing.instance_name, connectionStatus: "close", ownerJid: null }],
    });
    evolutionInstanceConnect.mockResolvedValue({
      ok: false,
      status: 500,
      error: "connect failed",
    });

    const response = await GET(new Request(
      "https://www.mychatcrm.com.br/api/admin/system-agent/evolution/session?slotIndex=0",
    ));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      phase: "connect_refresh",
      detail: "connect failed",
    });
  });

  it("rolls back the remote instance when the reservation cannot be finalized", async () => {
    reserveTenantEvolutionInstance.mockImplementation(async (params) => ({
      reserved: true,
      row: row(params.instanceName),
    }));
    finalizeTenantEvolutionInstanceReservation.mockRejectedValue(
      new Error("reservation no longer owns slot"),
    );

    const response = await POST(new Request("https://www.mychatcrm.com.br/api/admin/system-agent/evolution/session", {
      method: "POST",
    }));

    expect(response.status).toBe(503);
    expect(evolutionRemoveInstanceCompletely).toHaveBeenCalledTimes(1);
    expect(deleteTenantEvolutionInstanceRowIfName).toHaveBeenCalledTimes(1);
  });

  it("keeps the binding visible when disconnect cannot prove remote absence", async () => {
    const existing = {
      ...row("mc-existing", "open"),
      wa_jid: "556282067910@s.whatsapp.net",
    };
    getEvolutionInstanceByTenantSlot.mockResolvedValue(existing);
    resetSystemAgentEvolutionBinding.mockResolvedValue({
      ...resetSuccess(),
      currentInstance: existing.instance_name,
      currentInstanceRemoved: false,
      databaseBindingCleared: false,
      failedInstances: [
        {
          instanceName: existing.instance_name,
          presence: "present",
          status: 400,
          error: "Bad Request",
        },
      ],
      error: "one_or_more_system_instances_remain",
    });

    const response = await DELETE(new Request(
      "https://www.mychatcrm.com.br/api/admin/system-agent/evolution/session",
      { method: "DELETE" },
    ));

    expect(response.status).toBe(409);
    expect(updateEvolutionInstanceStateByName).toHaveBeenNthCalledWith(1, {
      instanceName: existing.instance_name,
      connectionState: "deleting",
      waJid: existing.wa_jid,
    });
    expect(updateEvolutionInstanceStateByName).toHaveBeenNthCalledWith(2, {
      instanceName: existing.instance_name,
      connectionState: "open",
      waJid: existing.wa_jid,
    });
  });
});
