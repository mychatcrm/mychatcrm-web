import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServiceClientMock } = vi.hoisted(() => ({
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import { resolveAllowedFunnelIds } from "@/lib/server/crm-funnel-access-db";

function makeSupabaseMock(opts: {
  rows?: Array<{ funnel_id: string }>;
  error?: { code?: string; message?: string } | null;
}) {
  const client = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () =>
              Promise.resolve({ data: opts.rows ?? [], error: opts.error ?? null }),
          }),
        }),
      };
    },
  };
  createSupabaseServiceClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  createSupabaseServiceClientMock.mockReset();
});

describe("resolveAllowedFunnelIds", () => {
  it("devolve null (sem restrição) quando não há liberação configurada", async () => {
    const sb = makeSupabaseMock({ rows: [] }) as never;
    expect(await resolveAllowedFunnelIds("tenant-a", "sel-1", sb)).toBeNull();
  });

  it("devolve os funis liberados, sem duplicatas", async () => {
    const sb = makeSupabaseMock({
      rows: [{ funnel_id: "funil-a" }, { funnel_id: "funil-b" }, { funnel_id: "funil-a" }],
    }) as never;
    expect(await resolveAllowedFunnelIds("tenant-a", "sel-1", sb)).toEqual(["funil-a", "funil-b"]);
  });

  it("nunca vira liberação geral quando a consulta falha", async () => {
    const sb = makeSupabaseMock({ error: { code: "500", message: "boom" } }) as never;
    expect(await resolveAllowedFunnelIds("tenant-a", "sel-1", sb)).toBeNull();
  });
});
