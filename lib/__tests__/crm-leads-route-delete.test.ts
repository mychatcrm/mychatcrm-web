import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientSessionFromCookiesMock, createSupabaseServiceClientMock, deleteLeadCompletelyMock } = vi.hoisted(() => ({
  getClientSessionFromCookiesMock: vi.fn(),
  createSupabaseServiceClientMock: vi.fn(),
  deleteLeadCompletelyMock: vi.fn(),
}));

vi.mock("@/lib/client-auth-server", () => ({
  getClientSessionFromCookies: getClientSessionFromCookiesMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

vi.mock("@/lib/server/delete-lead-completely", () => ({
  deleteLeadCompletely: deleteLeadCompletelyMock,
}));

import { DELETE as bulkDelete } from "@/app/api/client/crm/leads/route";
import { DELETE as singleDelete } from "@/app/api/client/crm/leads/[id]/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/crm/leads", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";

describe("CRM lead DELETE routes", () => {
  beforeEach(() => {
    getClientSessionFromCookiesMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    deleteLeadCompletelyMock.mockReset();
    createSupabaseServiceClientMock.mockReturnValue({});
  });

  it("fails without session", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue(null);

    const res = await bulkDelete(makeRequest({ ids: [idA] }));

    expect(res.status).toBe(401);
    expect(deleteLeadCompletelyMock).not.toHaveBeenCalled();
  });

  it("fails with an empty list", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue({ tenantId: "tenant-a" });

    const res = await bulkDelete(makeRequest({ ids: [] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Informe ao menos um lead para apagar.");
    expect(deleteLeadCompletelyMock).not.toHaveBeenCalled();
  });

  it("bulk deletes explicit ids and returns count", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue({ tenantId: "tenant-a" });
    deleteLeadCompletelyMock.mockResolvedValue({
      leadIds: [idA, idB],
      leadDeleted: 2,
      messagesDeleted: 10,
      summariesDeleted: 2,
      statesDeleted: 2,
      mediaDeleted: 3,
      mediaFailed: [],
      relatedRecordsDeleted: 1,
    });

    const res = await bulkDelete(makeRequest({ ids: [idA, idB] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ids: [idA, idB], count: 2 });
    expect(deleteLeadCompletelyMock).toHaveBeenCalledWith({
      sb: {},
      tenantId: "tenant-a",
      leadIds: [idA, idB],
    });
  });

  it("single delete returns the deleted id and count", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue({ tenantId: "tenant-a" });
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

    const res = await singleDelete(new Request("https://example.test"), { params: { id: idA } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, id: idA, ids: [idA], count: 1 });
  });
});
