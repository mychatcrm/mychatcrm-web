import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminSessionFromCookies = vi.hoisted(() => vi.fn());
const hasAdminAccess = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-auth", () => ({ getAdminSessionFromCookies, hasAdminAccess }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({ rpc }),
}));

import { GET } from "@/app/api/admin/clients/route";

describe("GET /api/admin/clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionFromCookies.mockResolvedValue({ id: "owner" });
    hasAdminAccess.mockReturnValue(true);
    rpc.mockResolvedValue({ data: { clients: [], total: 0 }, error: null });
  });

  it("loads the normalized database contract through the private RPC", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        clients: [{
          id: "tenant-1", name: "Cliente", email: "owner@example.com",
          planSlug: "escala", status: "active", createdAt: "2026-09-04T12:00:00Z",
          stripeCustomerId: "cus_1",
        }],
        total: 1,
      },
      error: null,
    });

    const response = await GET(new Request(
      "https://www.mychatcrm.com.br/api/admin/clients?q=Cliente&status=active&plan=escala",
    ));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_admin_clients_v1", {
      p_search: "Cliente", p_status: "active", p_plan: "escala", p_limit: 500,
    });
    await expect(response.json()).resolves.toMatchObject({ total: 1 });
  });

  it("fails closed when the database contract cannot be read", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "rpc_failed" } });
    const response = await GET(new Request("https://www.mychatcrm.com.br/api/admin/clients"));
    expect(response.status).toBe(500);
  });
});
