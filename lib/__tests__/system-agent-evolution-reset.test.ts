import { beforeEach, describe, expect, it, vi } from "vitest";

const evolutionFetchInstances = vi.hoisted(() => vi.fn());
const evolutionRemoveInstanceCompletely = vi.hoisted(() => vi.fn());

vi.mock("@/lib/integrations/evolution-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/evolution-api")>();
  return {
    ...actual,
    evolutionFetchInstances,
    evolutionRemoveInstanceCompletely,
  };
});

const deleteRowIfName = vi.hoisted(() => vi.fn());
const getSlot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { metadata: {} }, error: null }),
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByTenantId: vi.fn(),
  getEvolutionInstanceByTenantSlot: (...args: unknown[]) => getSlot(...args),
  deleteTenantEvolutionInstanceRowIfName: (...args: unknown[]) => deleteRowIfName(...args),
}));

import {
  getSystemEvolutionInstancePrefix,
  purgeSystemEvolutionInstances,
  resetSystemAgentEvolutionBinding,
} from "@/lib/server/system-agent";

function inventory(names: string[]) {
  return {
    ok: true,
    status: 200,
    error: null,
    data: names.map((name) => ({
      name,
      connectionStatus: "open",
      ownerJid: "556282194839@s.whatsapp.net",
      profileName: null,
    })),
  };
}

describe("system agent evolution reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteRowIfName.mockResolvedValue(true);
    getSlot.mockResolvedValue(null);
    evolutionRemoveInstanceCompletely.mockResolvedValue({
      ok: true,
      deleted: true,
      verifiedAbsent: true,
      presence: "absent",
      error: null,
      status: 200,
    });
  });

  it("purges all system-prefix instances except the kept one", async () => {
    const prefix = getSystemEvolutionInstancePrefix();
    const oldName = `${prefix}old1111`;
    const keptName = `${prefix}new2222`;
    evolutionFetchInstances
      .mockResolvedValueOnce(inventory([oldName, keptName, "mc976b7bclient"]))
      .mockResolvedValueOnce(inventory([keptName, "mc976b7bclient"]));

    const result = await purgeSystemEvolutionInstances(keptName);

    expect(result.inventoryVerified).toBe(true);
    expect(result.removedInstances).toEqual([oldName]);
    expect(result.failedInstances).toEqual([]);
    expect(evolutionRemoveInstanceCompletely).toHaveBeenCalledTimes(1);
  });

  it("clears the database only after every system instance is verified absent", async () => {
    const prefix = getSystemEvolutionInstancePrefix();
    const currentName = `${prefix}current`;
    const staleName = `${prefix}stale`;
    getSlot.mockResolvedValue({
      instance_name: currentName,
      connection_state: "open",
      wa_jid: "556282194839@s.whatsapp.net",
    });
    evolutionFetchInstances
      .mockResolvedValueOnce(inventory([staleName, currentName]))
      .mockResolvedValueOnce(inventory([]))
      .mockResolvedValueOnce(inventory([]));

    const result = await resetSystemAgentEvolutionBinding();

    expect(result.currentInstance).toBe(currentName);
    expect(result.currentInstanceRemoved).toBe(true);
    expect(result.databaseBindingCleared).toBe(true);
    expect(result.removedInstances).toEqual([staleName, currentName]);
    expect(deleteRowIfName).toHaveBeenCalledWith("tenant-system-internal", 0, currentName);
  });

  it("preserves the database binding when the initial inventory is unavailable", async () => {
    const currentName = `${getSystemEvolutionInstancePrefix()}current`;
    getSlot.mockResolvedValue({ instance_name: currentName, connection_state: "open", wa_jid: null });
    evolutionFetchInstances.mockResolvedValue({
      ok: false,
      status: 0,
      error: "timeout",
      data: [],
    });

    const result = await resetSystemAgentEvolutionBinding();

    expect(result.inventoryVerified).toBe(false);
    expect(result.currentInstanceRemoved).toBe(false);
    expect(result.databaseBindingCleared).toBe(false);
    expect(deleteRowIfName).not.toHaveBeenCalled();
  });

  it("preserves the database binding when delete returns 400 and the instance remains", async () => {
    const currentName = `${getSystemEvolutionInstancePrefix()}current`;
    getSlot.mockResolvedValue({ instance_name: currentName, connection_state: "open", wa_jid: null });
    evolutionFetchInstances
      .mockResolvedValueOnce(inventory([currentName]))
      .mockResolvedValueOnce(inventory([currentName]))
      .mockResolvedValueOnce(inventory([currentName]));
    evolutionRemoveInstanceCompletely.mockResolvedValue({
      ok: false,
      deleted: false,
      verifiedAbsent: false,
      presence: "present",
      error: "Bad Request",
      status: 400,
    });

    const result = await resetSystemAgentEvolutionBinding();

    expect(result.currentInstanceRemoved).toBe(false);
    expect(result.failedInstances).toEqual([
      expect.objectContaining({ instanceName: currentName, presence: "present" }),
    ]);
    expect(result.databaseBindingCleared).toBe(false);
    expect(deleteRowIfName).not.toHaveBeenCalled();
  });

  it("accepts a failed delete response only when the final inventory proves absence", async () => {
    const currentName = `${getSystemEvolutionInstancePrefix()}current`;
    getSlot.mockResolvedValue({ instance_name: currentName, connection_state: "open", wa_jid: null });
    evolutionFetchInstances
      .mockResolvedValueOnce(inventory([currentName]))
      .mockResolvedValueOnce(inventory([]))
      .mockResolvedValueOnce(inventory([]));
    evolutionRemoveInstanceCompletely.mockResolvedValue({
      ok: false,
      deleted: false,
      verifiedAbsent: false,
      presence: "unknown",
      error: "connection reset",
      status: 0,
    });

    const result = await resetSystemAgentEvolutionBinding();

    expect(result.inventoryVerified).toBe(true);
    expect(result.currentInstanceRemoved).toBe(true);
    expect(result.databaseBindingCleared).toBe(true);
    expect(deleteRowIfName).toHaveBeenCalled();
  });

  it("preserves the database when the final verification becomes unknown", async () => {
    const currentName = `${getSystemEvolutionInstancePrefix()}current`;
    getSlot.mockResolvedValue({ instance_name: currentName, connection_state: "open", wa_jid: null });
    evolutionFetchInstances
      .mockResolvedValueOnce(inventory([currentName]))
      .mockResolvedValueOnce(inventory([]))
      .mockResolvedValueOnce({ ok: false, status: 0, error: "inventory timeout", data: [] });

    const result = await resetSystemAgentEvolutionBinding();

    expect(result.inventoryVerified).toBe(false);
    expect(result.failedInstances).toEqual([
      expect.objectContaining({ instanceName: currentName, presence: "unknown" }),
    ]);
    expect(result.databaseBindingCleared).toBe(false);
    expect(deleteRowIfName).not.toHaveBeenCalled();
  });
});
