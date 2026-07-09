import { describe, expect, it, vi } from "vitest";

const { createSupabaseServiceClient, getEvolutionInstanceByTenantSlot, getWhatsAppCloudConnection } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  getEvolutionInstanceByTenantSlot: vi.fn(),
  getWhatsAppCloudConnection: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient }));
vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({ getEvolutionInstanceByTenantSlot }));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({ getWhatsAppCloudConnection }));

import { getSlotActiveProvider, setSlotActiveProvider } from "@/lib/server/whatsapp-slot-provider";

type Row = Record<string, unknown>;

function makeFakeSb() {
  const slotState: Row[] = [];
  const ruleUpdates: { filters: Record<string, unknown>; patch: Row }[] = [];
  const rules: Row[] = [
    { id: "rule-1", tenant_id: "t1", connection_id: "evo-uuid-1", transport: "evolution" },
  ];

  const sb = {
    from: (table: string) => {
      if (table === "tenant_whatsapp_slot_state") {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => ({
              eq: (col2: string, val2: unknown) => ({
                maybeSingle: async () => ({
                  data: slotState.find((r) => r[col] === val && r[col2] === val2) ?? null,
                  error: null,
                }),
              }),
            }),
          }),
          upsert: (payload: Row) => {
            const idx = slotState.findIndex((r) => r.tenant_id === payload.tenant_id && r.slot_index === payload.slot_index);
            if (idx >= 0) slotState[idx] = { ...slotState[idx], ...payload };
            else slotState.push({ ...payload });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "lead_distribution_rules") {
        return {
          update: (patch: Row) => ({
            eq: (col: string, val: unknown) => ({
              eq: (col2: string, val2: unknown) => {
                const filters = { [col]: val, [col2]: val2 };
                ruleUpdates.push({ filters, patch });
                for (const rule of rules) {
                  if (Object.entries(filters).every(([k, v]) => rule[k] === v)) Object.assign(rule, patch);
                }
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { sb, slotState, ruleUpdates, rules };
}

describe("getSlotActiveProvider", () => {
  it("defaults to evolution when no state row exists", async () => {
    const { sb } = makeFakeSb();
    createSupabaseServiceClient.mockReturnValue(sb);

    expect(await getSlotActiveProvider("t1", 0)).toBe("evolution");
  });
});

describe("setSlotActiveProvider", () => {
  it("switches the record and repoints lead_distribution_rules from the old connection to the new one", async () => {
    const { sb, slotState, rules } = makeFakeSb();
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ id: "evo-uuid-1" });
    getWhatsAppCloudConnection.mockResolvedValue({ phone_number_id: "meta-123" });

    await setSlotActiveProvider("t1", 0, "cloud_api");

    expect(slotState).toEqual([
      expect.objectContaining({ tenant_id: "t1", slot_index: 0, active_provider: "cloud_api" }),
    ]);
    expect(rules[0]).toMatchObject({ connection_id: "meta-123", transport: "cloud_api" });
  });

  it("does nothing to lead_distribution_rules when the other side has no connection yet", async () => {
    const { sb, rules } = makeFakeSb();
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue(null);
    getWhatsAppCloudConnection.mockResolvedValue({ phone_number_id: "meta-999" });

    await setSlotActiveProvider("t1", 0, "cloud_api");

    expect(rules[0]).toMatchObject({ connection_id: "evo-uuid-1", transport: "evolution" });
  });
});
