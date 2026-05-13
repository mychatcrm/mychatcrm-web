import { describe, expect, it, vi } from "vitest";
import {
  deleteCrmLeadsForTenant,
  normalizeCrmLeadIds,
  validateCrmLeadIds,
} from "@/lib/server/crm-leads-delete";

type DeleteCall = {
  table: string;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
};

function makeDeleteClient(rows: Array<{ id: string }>, error: { code?: string; message?: string } | null = null) {
  const call: DeleteCall = { table: "", eqs: [], ins: [] };
  const client = {
    from(table: string) {
      call.table = table;
      return {
        delete() {
          return {
            eq(key: string, value: unknown) {
              call.eqs.push([key, value]);
              return this;
            },
            in(key: string, value: unknown[]) {
              call.ins.push([key, value]);
              return this;
            },
            select: vi.fn(async () => ({ data: rows, error })),
          };
        },
      };
    },
  };
  return { client, call };
}

const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";

describe("CRM lead deletion helpers", () => {
  it("normalizes and deduplicates explicit ids", () => {
    expect(normalizeCrmLeadIds([idA, " ", idA, idB, 12])).toEqual([idA, idB]);
  });

  it("fails with an empty list", () => {
    expect(validateCrmLeadIds([])).toBe("Informe ao menos um lead para apagar.");
  });

  it("rejects invalid ids instead of allowing broad deletes", () => {
    expect(validateCrmLeadIds(["all"])).toBe("Lista de leads inválida.");
  });

  it("deletes one lead scoped by tenant_id", async () => {
    const { client, call } = makeDeleteClient([{ id: idA }]);
    const result = await deleteCrmLeadsForTenant({
      sb: client as never,
      tenantId: "tenant-a",
      ids: [idA],
    });

    expect(call.table).toBe("leads");
    expect(call.eqs).toEqual([["tenant_id", "tenant-a"]]);
    expect(call.ins).toEqual([["id", [idA]]]);
    expect(result.deletedIds).toEqual([idA]);
    expect(result.deletedCount).toBe(1);
  });

  it("deletes multiple leads scoped by tenant_id", async () => {
    const { client, call } = makeDeleteClient([{ id: idA }, { id: idB }]);
    const result = await deleteCrmLeadsForTenant({
      sb: client as never,
      tenantId: "tenant-a",
      ids: [idA, idB],
    });

    expect(call.eqs).toEqual([["tenant_id", "tenant-a"]]);
    expect(call.ins).toEqual([["id", [idA, idB]]]);
    expect(result.deletedCount).toBe(2);
  });

  it("does not report another tenant lead as deleted when Supabase returns no rows", async () => {
    const { client, call } = makeDeleteClient([]);
    const result = await deleteCrmLeadsForTenant({
      sb: client as never,
      tenantId: "tenant-a",
      ids: [idA],
    });

    expect(call.eqs).toEqual([["tenant_id", "tenant-a"]]);
    expect(result.deletedIds).toEqual([]);
    expect(result.deletedCount).toBe(0);
  });
});
