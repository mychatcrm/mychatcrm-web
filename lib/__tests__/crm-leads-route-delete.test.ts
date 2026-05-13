import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientSessionFromCookiesMock, createSupabaseServiceClientMock } = vi.hoisted(() => ({
  getClientSessionFromCookiesMock: vi.fn(),
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/client-auth-server", () => ({
  getClientSessionFromCookies: getClientSessionFromCookiesMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import { DELETE as bulkDelete } from "@/app/api/client/crm/leads/route";
import { DELETE as singleDelete } from "@/app/api/client/crm/leads/[id]/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/crm/leads", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

function makeDeleteClient(rows: Array<{ id: string }>) {
  return {
    from: vi.fn(() => ({
      delete: vi.fn(() => ({
        eq: vi.fn(function eq() {
          return this;
        }),
        in: vi.fn(function inFn() {
          return this;
        }),
        select: vi.fn(async () => ({ data: rows, error: null })),
      })),
    })),
  };
}

const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";

describe("CRM lead DELETE routes", () => {
  beforeEach(() => {
    getClientSessionFromCookiesMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
  });

  it("fails without session", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue(null);

    const res = await bulkDelete(makeRequest({ ids: [idA] }));

    expect(res.status).toBe(401);
    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
  });

  it("fails with an empty list", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue({ tenantId: "tenant-a" });

    const res = await bulkDelete(makeRequest({ ids: [] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Informe ao menos um lead para apagar.");
    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
  });

  it("bulk deletes explicit ids and returns count", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue({ tenantId: "tenant-a" });
    createSupabaseServiceClientMock.mockReturnValue(makeDeleteClient([{ id: idA }, { id: idB }]));

    const res = await bulkDelete(makeRequest({ ids: [idA, idB] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ids: [idA, idB], count: 2 });
  });

  it("single delete returns the deleted id and count", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue({ tenantId: "tenant-a" });
    createSupabaseServiceClientMock.mockReturnValue(makeDeleteClient([{ id: idA }]));

    const res = await singleDelete(new Request("https://example.test"), { params: { id: idA } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, id: idA, ids: [idA], count: 1 });
  });
});
