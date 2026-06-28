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

const deleteRow = vi.hoisted(() => vi.fn());
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
  deleteTenantEvolutionInstanceRow: (...args: unknown[]) => deleteRow(...args),
}));

import {
  getSystemEvolutionInstancePrefix,
  purgeSystemEvolutionInstances,
  resetSystemAgentEvolutionBinding,
} from "@/lib/server/system-agent";

describe("system agent evolution reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteRow.mockResolvedValue(undefined);
    getSlot.mockResolvedValue({ instance_name: "mc049357abc12345", connection_state: "open", wa_jid: "556282194839@s.whatsapp.net" });
    evolutionRemoveInstanceCompletely.mockResolvedValue({
      ok: true,
      deleted: true,
      verifiedAbsent: true,
      error: null,
      status: 200,
    });
  });

  it("purges all system-prefix instances except the kept one", async () => {
    const prefix = getSystemEvolutionInstancePrefix();
    evolutionFetchInstances.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        { name: `${prefix}old1111`, connectionStatus: "open", ownerJid: "556282194839@s.whatsapp.net", profileName: null },
        { name: `${prefix}new2222`, connectionStatus: "open", ownerJid: "556282067910@s.whatsapp.net", profileName: null },
        { name: "mc976b7bclient", connectionStatus: "open", ownerJid: null, profileName: null },
      ],
    });

    const purged = await purgeSystemEvolutionInstances(`${prefix}new2222`);
    expect(purged).toEqual([`${prefix}old1111`]);
    expect(evolutionRemoveInstanceCompletely).toHaveBeenCalledTimes(1);
  });

  it("reset binding purges evolution, deletes db row and clears metadata path", async () => {
    const prefix = getSystemEvolutionInstancePrefix();
    evolutionFetchInstances.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ name: `${prefix}stale`, connectionStatus: "open", ownerJid: "556282194839@s.whatsapp.net", profileName: null }],
    });

    const result = await resetSystemAgentEvolutionBinding();
    expect(result.deletedDbInstance).toBe("mc049357abc12345");
    expect(result.purgedInstances).toContain(`${prefix}stale`);
    expect(deleteRow).toHaveBeenCalled();
  });
});
