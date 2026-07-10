import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evolutionFetchInstancesMock,
  getEvolutionInstanceByIdForTenantMock,
  getEvolutionInstanceByNameMock,
  upsertTenantEvolutionInstanceMock,
} = vi.hoisted(() => ({
  evolutionFetchInstancesMock: vi.fn(),
  getEvolutionInstanceByIdForTenantMock: vi.fn(),
  getEvolutionInstanceByNameMock: vi.fn(),
  upsertTenantEvolutionInstanceMock: vi.fn(),
}));

vi.mock("@/lib/integrations/evolution-api", () => ({
  buildEvolutionInstanceName: () => "mc-slot-prefix",
  evolutionFetchInstances: evolutionFetchInstancesMock,
}));

vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByIdForTenant: getEvolutionInstanceByIdForTenantMock,
  getEvolutionInstanceByName: getEvolutionInstanceByNameMock,
  upsertTenantEvolutionInstance: upsertTenantEvolutionInstanceMock,
}));

import { reconcileLiveEvolutionInstance } from "@/lib/server/evolution-instance-reconciliation";

const row = {
  id: "connection-1",
  tenant_id: "tenant-1",
  slot_index: 0,
  instance_name: "mc-slot-prefix-old",
  connection_state: "open",
  wa_jid: "551100000000@s.whatsapp.net",
  default_agent_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("reconcileLiveEvolutionInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEvolutionInstanceByNameMock.mockResolvedValue(null);
    upsertTenantEvolutionInstanceMock.mockImplementation(async (payload) => ({
      ...row,
      instance_name: payload.instanceName,
      connection_state: payload.connectionState,
      wa_jid: payload.waJid,
    }));
  });

  it("keeps the exact stored instance when it is authenticated", async () => {
    evolutionFetchInstancesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          name: row.instance_name,
          connectionStatus: "open",
          ownerJid: row.wa_jid,
          profileName: null,
        },
      ],
    });

    const result = await reconcileLiveEvolutionInstance(row);

    expect(result).toEqual({ ok: true, instance: row, adoptedSibling: false });
    expect(upsertTenantEvolutionInstanceMock).not.toHaveBeenCalled();
  });

  it("adopts the only authenticated sibling while preserving the logical slot", async () => {
    evolutionFetchInstancesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        { name: row.instance_name, connectionStatus: "close", ownerJid: null, profileName: null },
        {
          name: "mc-slot-prefix-new",
          connectionStatus: "open",
          ownerJid: "552200000000@s.whatsapp.net",
          profileName: null,
        },
      ],
    });

    const result = await reconcileLiveEvolutionInstance(row);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.adoptedSibling).toBe(true);
      expect(result.instance.instance_name).toBe("mc-slot-prefix-new");
    }
    expect(upsertTenantEvolutionInstanceMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      slotIndex: 0,
      instanceName: "mc-slot-prefix-new",
      connectionState: "open",
      waJid: "552200000000@s.whatsapp.net",
      defaultAgentId: null,
    });
  });

  it("fails closed when no authenticated instance exists", async () => {
    evolutionFetchInstancesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ name: row.instance_name, connectionStatus: "close", ownerJid: null, profileName: null }],
    });

    const result = await reconcileLiveEvolutionInstance(row);

    expect(result).toEqual({ ok: false, instance: row, reason: "connection_not_open" });
    expect(upsertTenantEvolutionInstanceMock).not.toHaveBeenCalled();
  });

  it("does not choose between multiple authenticated siblings", async () => {
    evolutionFetchInstancesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          name: "mc-slot-prefix-one",
          connectionStatus: "open",
          ownerJid: "551100000001@s.whatsapp.net",
          profileName: null,
        },
        {
          name: "mc-slot-prefix-two",
          connectionStatus: "open",
          ownerJid: "551100000002@s.whatsapp.net",
          profileName: null,
        },
      ],
    });

    const result = await reconcileLiveEvolutionInstance(row);

    expect(result).toEqual({
      ok: false,
      instance: row,
      reason: "ambiguous_connected_siblings",
    });
    expect(upsertTenantEvolutionInstanceMock).not.toHaveBeenCalled();
  });

  it("does not adopt a sibling already bound to another logical connection", async () => {
    evolutionFetchInstancesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          name: "mc-slot-prefix-new",
          connectionStatus: "open",
          ownerJid: "552200000000@s.whatsapp.net",
          profileName: null,
        },
      ],
    });
    getEvolutionInstanceByNameMock.mockResolvedValue({ ...row, id: "connection-2" });

    const result = await reconcileLiveEvolutionInstance(row);

    expect(result).toEqual({
      ok: false,
      instance: row,
      reason: "connected_sibling_already_bound",
    });
    expect(upsertTenantEvolutionInstanceMock).not.toHaveBeenCalled();
  });
});
