import { describe, expect, it, vi } from "vitest";

const { createSupabaseServiceClientMock } = vi.hoisted(() => ({
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";

describe("readTeamMembersFromDb", () => {
  it("falls back to the security-definer member lookup when direct select is denied", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: null,
            error: { code: "42501", message: "permission denied for table tenant_members" },
          })),
        })),
      })),
      rpc: vi.fn(async () => ({
        data: [
          {
            id: "emp-director",
            tenant_id: "tenant-a",
            nome: "Director",
            email: "director@example.com",
            password_hash: "hidden",
            funcao: "Diretoria",
            hierarchy_role: "director",
            reports_to_id: null,
            ativo: true,
            account_suspended: false,
          },
        ],
        error: null,
      })),
    };
    createSupabaseServiceClientMock.mockReturnValue(client);

    const members = await readTeamMembersFromDb("tenant-a", "director@example.com");

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ id: "emp-director", hierarchyRole: "director" });
    expect(client.rpc).toHaveBeenCalledWith("get_member_by_email", { p_email: "director@example.com" });
  });
});
