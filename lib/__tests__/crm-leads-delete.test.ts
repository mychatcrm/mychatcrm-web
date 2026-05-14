import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteCrmLeadsForTenant,
  normalizeCrmLeadIds,
  validateCrmLeadIds,
} from "@/lib/server/crm-leads-delete";

const deleteLeadCompletelyMock = vi.fn();

vi.mock("@/lib/server/delete-lead-completely", () => ({
  deleteLeadCompletely: (...args: unknown[]) => deleteLeadCompletelyMock(...args),
}));

const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";

describe("CRM lead deletion helpers", () => {
  beforeEach(() => {
    deleteLeadCompletelyMock.mockReset();
  });

  it("normalizes and deduplicates explicit ids", () => {
    expect(normalizeCrmLeadIds([idA, " ", idA, idB, 12])).toEqual([idA, idB]);
  });

  it("fails with an empty list", () => {
    expect(validateCrmLeadIds([])).toBe("Informe ao menos um lead para apagar.");
  });

  it("rejects invalid ids instead of allowing broad deletes", () => {
    expect(validateCrmLeadIds(["all"])).toBe("Lista de leads inválida.");
  });

  it("delegates complete deletion scoped by tenant_id", async () => {
    deleteLeadCompletelyMock.mockResolvedValue({
      leadIds: [idA],
      leadDeleted: 1,
      messagesDeleted: 4,
      summariesDeleted: 1,
      statesDeleted: 1,
      mediaDeleted: 2,
      mediaFailed: [],
      relatedRecordsDeleted: 0,
    });

    const result = await deleteCrmLeadsForTenant({
      sb: {} as never,
      tenantId: "tenant-a",
      ids: [idA],
    });

    expect(deleteLeadCompletelyMock).toHaveBeenCalledWith({
      sb: {},
      tenantId: "tenant-a",
      leadIds: [idA],
    });
    expect(result.deletedIds).toEqual([idA]);
    expect(result.deletedCount).toBe(1);
    expect(result.report?.messagesDeleted).toBe(4);
  });

  it("returns empty result when no leads match tenant", async () => {
    deleteLeadCompletelyMock.mockResolvedValue({
      leadIds: [],
      leadDeleted: 0,
      messagesDeleted: 0,
      summariesDeleted: 0,
      statesDeleted: 0,
      mediaDeleted: 0,
      mediaFailed: [],
      relatedRecordsDeleted: 0,
    });

    const result = await deleteCrmLeadsForTenant({
      sb: {} as never,
      tenantId: "tenant-a",
      ids: [idA],
    });

    expect(result.deletedIds).toEqual([]);
    expect(result.deletedCount).toBe(0);
  });
});
