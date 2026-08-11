import { describe, expect, it, vi } from "vitest";

type ThenableResult = { data: unknown; error: unknown } & PromiseLike<{ data: unknown; error: unknown }>;

function fakeQuery(data: unknown): ThenableResult {
  const result = { data, error: null };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  return builder as ThenableResult;
}

const createSupabaseServiceClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient }));

import { listTenantWhatsappConnections } from "@/lib/server/tenant-whatsapp-connections";

describe("listTenantWhatsappConnections", () => {
  it("merges Evolution instances and Meta Cloud connections with the right labels, connectionId and activeProvider", async () => {
    createSupabaseServiceClient.mockReturnValue({
      from: (table: string) => {
        if (table === "tenant_evolution_instances") {
          return fakeQuery([
            { id: "evo-uuid-1", slot_index: 0, wa_jid: "5562993580574@s.whatsapp.net", connection_state: "open" },
            { id: "evo-uuid-2", slot_index: 1, wa_jid: null, connection_state: "close" },
          ]);
        }
        if (table === "whatsapp_cloud_connections") {
          return fakeQuery([
            { phone_number_id: "1224395060758616", slot_index: 0, display_phone: "+55 62 8206-7910", active: true },
          ]);
        }
        if (table === "tenant_whatsapp_slot_state") {
          return fakeQuery([
            { slot_index: 0, active_provider: "cloud_api" },
            { slot_index: 1, active_provider: "evolution" },
          ]);
        }
        throw new Error(`unexpected table ${table}`);
      },
    });

    const connections = await listTenantWhatsappConnections("tenant-1");

    expect(connections).toEqual([
      {
        connectionId: "evo-uuid-1",
        transport: "evolution",
        label: "QR Code · +5562993580574",
        slotIndex: 0,
        connected: true,
        activeProvider: "cloud_api",
      },
      {
        connectionId: "evo-uuid-2",
        transport: "evolution",
        label: "QR Code",
        slotIndex: 1,
        connected: false,
        activeProvider: "evolution",
      },
      {
        connectionId: "1224395060758616",
        transport: "cloud_api",
        label: "API Meta · +55 62 8206-7910",
        slotIndex: 0,
        connected: true,
        activeProvider: "cloud_api",
      },
    ]);
  });

  it("returns an empty list when the tenant has no connections", async () => {
    createSupabaseServiceClient.mockReturnValue({
      from: () => fakeQuery([]),
    });

    expect(await listTenantWhatsappConnections("tenant-empty")).toEqual([]);
  });
});
