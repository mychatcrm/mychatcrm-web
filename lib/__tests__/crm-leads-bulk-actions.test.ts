import { describe, expect, it } from "vitest";
import {
  executeCrmLeadBulkAction,
  validateCrmBulkStatus,
} from "@/lib/server/crm-leads-bulk-actions";
import type { TeamEmployee } from "@/lib/team-employees-types";

const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";
const otherTenantId = "33333333-3333-4333-8333-333333333333";

function employee(id = "emp-1"): TeamEmployee {
  return {
    id,
    nome: "Atendente Um",
    email: "atendente@example.com",
    funcao: "Atendimento",
    initialPassword: "",
    ativo: true,
    hierarchyRole: "seller",
  };
}

function makeClient(validLeadIds: string[]) {
  const calls = {
    leadUpdates: [] as Array<Record<string, unknown>>,
    deletes: [] as string[][],
    offers: [] as Array<Record<string, unknown>>,
    links: [] as Array<Record<string, unknown>>,
  };

  const client = {
    from(table: string) {
      if (table === "leads") {
        return {
          select() {
            return {
              eq() {
                return {
                  async in(_key: string, ids: string[]) {
                    return {
                      data: ids.filter((id) => validLeadIds.includes(id)).map((id) => ({ id })),
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            calls.leadUpdates.push(patch);
            return {
              eq() {
                return {
                  in(_key: string, ids: string[]) {
                    return {
                      async select() {
                        return {
                          data: ids.filter((id) => validLeadIds.includes(id)).map((id) => ({ id })),
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          delete() {
            return {
              eq() {
                return {
                  in(_key: string, ids: string[]) {
                    calls.deletes.push(ids);
                    return {
                      async select() {
                        return {
                          data: ids.filter((id) => validLeadIds.includes(id)).map((id) => ({ id })),
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "active_offers") {
        return {
          insert(payload: Record<string, unknown>) {
            calls.offers.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: {
                        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                        title: payload.title,
                        status: "active",
                        created_at: "2026-05-13T10:00:00.000Z",
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      return {
        upsert(rows: Array<Record<string, unknown>>) {
          calls.links.push(...rows);
          return {
            async select() {
              return { data: rows.map((row) => ({ lead_id: row.lead_id })), error: null };
            },
          };
        },
      };
    },
  };

  return { client, calls };
}

describe("CRM bulk actions", () => {
  it("fails with an empty list", async () => {
    const { client } = makeClient([]);

    await expect(
      executeCrmLeadBulkAction({
        sb: client as never,
        tenantId: "tenant-a",
        action: "delete",
        leadIds: [],
      }),
    ).rejects.toThrow("Informe ao menos um lead para apagar.");
  });

  it("does not update when one lead is outside the tenant", async () => {
    const { client, calls } = makeClient([idA]);

    await expect(
      executeCrmLeadBulkAction({
        sb: client as never,
        tenantId: "tenant-a",
        action: "assign_attendant",
        leadIds: [idA, otherTenantId],
        payload: { employeeId: "emp-1" },
        teamEmployees: [employee()],
      }),
    ).rejects.toThrow("Alguns leads não pertencem ao tenant atual");

    expect(calls.leadUpdates).toHaveLength(0);
  });

  it("assigns an attendant scoped by tenant-validated leads", async () => {
    const { client, calls } = makeClient([idA, idB]);

    const result = await executeCrmLeadBulkAction({
      sb: client as never,
      tenantId: "tenant-a",
      action: "assign_attendant",
      leadIds: [idA, idB],
      payload: { employeeId: "emp-1" },
      teamEmployees: [employee()],
    });

    expect(result.affectedCount).toBe(2);
    expect(calls.leadUpdates[0]).toMatchObject({ owner_employee_id: "emp-1" });
  });

  it("rejects invalid status before updating leads", async () => {
    const { client, calls } = makeClient([idA]);

    await expect(
      executeCrmLeadBulkAction({
        sb: client as never,
        tenantId: "tenant-a",
        action: "change_status",
        leadIds: [idA],
        payload: { status: "fantasma", allowedStatusIds: ["novo", "contato"] },
      }),
    ).rejects.toThrow("Status inválido");

    expect(calls.leadUpdates).toHaveLength(0);
  });

  it("changes status for selected leads", async () => {
    const { client, calls } = makeClient([idA]);

    const result = await executeCrmLeadBulkAction({
      sb: client as never,
      tenantId: "tenant-a",
      action: "change_status",
      leadIds: [idA],
      payload: { status: "contato", funnelId: "funil-default", allowedStatusIds: ["novo", "contato"] },
    });

    expect(result.affectedCount).toBe(1);
    expect(calls.leadUpdates[0]).toMatchObject({ status: "contato", crm_funnel_id: "funil-default" });
  });

  it("creates an active offer and links selected tenant leads", async () => {
    const { client, calls } = makeClient([idA, idB]);

    const result = await executeCrmLeadBulkAction({
      sb: client as never,
      tenantId: "tenant-a",
      actorEmail: "owner@example.com",
      action: "convert_to_active_offer",
      leadIds: [idA, idB],
      payload: { title: "Oferta ativa teste" },
    });

    expect(result.offer?.title).toBe("Oferta ativa teste");
    expect(calls.offers[0]).toMatchObject({ tenant_id: "tenant-a", title: "Oferta ativa teste" });
    expect(calls.links).toHaveLength(2);
    expect(calls.links[0]).toMatchObject({ tenant_id: "tenant-a", lead_id: idA });
  });

  it("validates status against the allowed list", () => {
    expect(() => validateCrmBulkStatus({ status: "novo", allowedStatusIds: ["novo"] })).not.toThrow();
    expect(() => validateCrmBulkStatus({ status: "perdido", allowedStatusIds: ["novo"] })).toThrow("Status inválido");
  });
});
