import { describe, expect, it, vi } from "vitest";

const createSupabaseServiceClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient }));

import {
  deleteWhatsAppCloudConnection,
  getWhatsAppCloudConnection,
  upsertWhatsAppCloudConnection,
} from "@/lib/server/whatsapp-cloud-connections";

type Row = Record<string, unknown>;

/** Registers rows per tenant+slot, mirroring the real unique(tenant_id, slot_index) table. */
function makeFakeTable(initialRows: Row[]) {
  const rows: Row[] = [...initialRows];
  const calls: { method: string; args: unknown[] }[] = [];

  function query(filters: Record<string, unknown> = {}) {
    const eqCalls = { ...filters };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        eqCalls[col] = val;
        return builder;
      },
      maybeSingle: async () => {
        const match = rows.find((r) => Object.entries(eqCalls).every(([k, v]) => r[k] === v));
        return { data: match ?? null, error: null };
      },
      delete: () => {
        calls.push({ method: "delete", args: [] });
        return {
          eq: (col: string, val: unknown) => {
            eqCalls[col] = val;
            return {
              eq: (col2: string, val2: unknown) => {
                eqCalls[col2] = val2;
                const remaining = rows.filter(
                  (r) => !Object.entries(eqCalls).every(([k, v]) => r[k] === v),
                );
                rows.length = 0;
                rows.push(...remaining);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
      upsert: (payload: Row, opts: { onConflict: string }) => {
        calls.push({ method: "upsert", args: [payload, opts] });
        const conflictCols = opts.onConflict.split(",");
        const idx = rows.findIndex((r) => conflictCols.every((c) => r[c] === payload[c]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
        else rows.push({ ...payload });
        return Promise.resolve({ error: null });
      },
    };
    return builder;
  }

  return { rows, calls, query };
}

describe("whatsapp-cloud-connections — multi-slot", () => {
  it("getWhatsAppCloudConnection scopes strictly to tenant_id + slot_index", async () => {
    const table = makeFakeTable([
      { tenant_id: "t1", slot_index: 0, phone_number_id: "A", active: true },
      { tenant_id: "t1", slot_index: 1, phone_number_id: "B", active: true },
      { tenant_id: "t2", slot_index: 0, phone_number_id: "C", active: true },
    ]);
    createSupabaseServiceClient.mockReturnValue({ from: () => table.query() });

    const slot0 = await getWhatsAppCloudConnection("t1", 0);
    const slot1 = await getWhatsAppCloudConnection("t1", 1);
    const otherTenantSlot0 = await getWhatsAppCloudConnection("t2", 0);

    expect(slot0?.phone_number_id).toBe("A");
    expect(slot1?.phone_number_id).toBe("B");
    expect(otherTenantSlot0?.phone_number_id).toBe("C");
  });

  it("upsertWhatsAppCloudConnection conflicts on tenant_id+slot_index, not on phone_number_id alone", async () => {
    const table = makeFakeTable([]);
    createSupabaseServiceClient.mockReturnValue({ from: () => table.query() });

    await upsertWhatsAppCloudConnection({
      tenantId: "t1",
      slotIndex: 0,
      phoneNumberId: "A",
      wabaId: "waba-1",
      accessToken: "token-a",
      displayPhone: "+5511111111",
      verifiedName: "Linha 1",
    });
    await upsertWhatsAppCloudConnection({
      tenantId: "t1",
      slotIndex: 1,
      phoneNumberId: "B",
      wabaId: "waba-2",
      accessToken: "token-b",
      displayPhone: "+5522222222",
      verifiedName: "Linha 2",
    });

    expect(table.rows).toHaveLength(2);
    expect(table.rows.find((r) => r.slot_index === 0)?.phone_number_id).toBe("A");
    expect(table.rows.find((r) => r.slot_index === 1)?.phone_number_id).toBe("B");
    expect(table.calls.every((c) => c.method !== "upsert" || (c.args[1] as { onConflict: string }).onConflict === "tenant_id,slot_index")).toBe(true);
  });

  it("deleteWhatsAppCloudConnection removes only the targeted slot, leaving other lines intact", async () => {
    const table = makeFakeTable([
      { tenant_id: "t1", slot_index: 0, phone_number_id: "A", active: true },
      { tenant_id: "t1", slot_index: 1, phone_number_id: "B", active: true },
    ]);
    createSupabaseServiceClient.mockReturnValue({ from: () => table.query() });

    await deleteWhatsAppCloudConnection("t1", 0);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.slot_index).toBe(1);
  });
});
