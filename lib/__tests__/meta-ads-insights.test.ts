import { beforeEach, describe, expect, it, vi } from "vitest";

const { metaGraphRequestMock } = vi.hoisted(() => ({ metaGraphRequestMock: vi.fn() }));

vi.mock("@/lib/server/meta-graph-api", () => ({
  metaGraphRequest: metaGraphRequestMock,
  metaGraphErrorCode: (error: unknown) => (error instanceof Error ? error.message : "unknown"),
}));

import { loadCampaignSpend } from "@/lib/server/meta-ads-insights";

type Options = {
  cache?: unknown[];
  cacheError?: { code: string };
  userToken?: string | null;
};

function makeSupabase(options: Options = {}) {
  const upserts: unknown[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "meta_connections"
                ? { user_access_token: options.userToken ?? null }
                : null,
            error: null,
          }),
        in: () =>
          Promise.resolve({
            data: options.cache ?? [],
            error: options.cacheError ?? null,
          }),
        upsert(payload: unknown) {
          upserts.push(payload);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, upserts };
}

beforeEach(() => {
  metaGraphRequestMock.mockReset();
});

describe("loadCampaignSpend", () => {
  it("usa o cache fresco sem chamar a Meta", async () => {
    const { client } = makeSupabase({
      cache: [
        {
          object_id: "camp-1",
          object_name: "Campanha",
          spend: "150.50",
          impressions: "1000",
          clicks: "50",
          reach: "800",
          currency: "BRL",
          meta_reported_leads: 12,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
    });

    const result = await loadCampaignSpend({
      sb: client, tenantId: "t", campaignIds: ["camp-1"], from: "2026-09-01", to: "2026-09-17",
    });

    expect(result?.get("camp-1")?.spend).toBe(150.5);
    expect(metaGraphRequestMock).not.toHaveBeenCalled();
  });

  it("busca na Meta quando o cache expirou e grava de volta", async () => {
    metaGraphRequestMock.mockResolvedValue({
      data: [
        {
          spend: "300.00",
          impressions: "5000",
          clicks: "120",
          reach: "4200",
          account_currency: "BRL",
          actions: [{ action_type: "leadgen.other", value: "30" }],
        },
      ],
    });

    const { client, upserts } = makeSupabase({
      cache: [
        {
          object_id: "camp-1", object_name: null, spend: "1", impressions: "1", clicks: "1",
          reach: "1", currency: "BRL", meta_reported_leads: 0,
          expires_at: new Date(Date.now() - 1000).toISOString(),
        },
      ],
      userToken: "user-token",
    });

    const result = await loadCampaignSpend({
      sb: client, tenantId: "t", campaignIds: ["camp-1"], from: "2026-09-01", to: "2026-09-17",
    });

    expect(result?.get("camp-1")?.spend).toBe(300);
    expect(result?.get("camp-1")?.metaReportedLeads).toBe(30);
    expect(upserts).toHaveLength(1);
  });

  /** Zero significaria "campanha de graça" — devolver "não sei" é mais honesto. */
  it("sem token de usuário devolve null em vez de zero", async () => {
    const { client } = makeSupabase({ cache: [], userToken: null });

    const result = await loadCampaignSpend({
      sb: client, tenantId: "t", campaignIds: ["camp-1"], from: "2026-09-01", to: "2026-09-17",
    });

    expect(result).toBeNull();
  });

  it("sem a tabela de cache devolve null", async () => {
    const { client } = makeSupabase({ cacheError: { code: "42P01" } });

    const result = await loadCampaignSpend({
      sb: client, tenantId: "t", campaignIds: ["camp-1"], from: "2026-09-01", to: "2026-09-17",
    });

    expect(result).toBeNull();
  });

  it("campanha sem permissão não derruba as outras", async () => {
    metaGraphRequestMock
      .mockRejectedValueOnce(new Error("permission"))
      .mockResolvedValueOnce({ data: [{ spend: "10.00", impressions: "1", clicks: "1", reach: "1" }] });

    const { client } = makeSupabase({ cache: [], userToken: "user-token" });

    const result = await loadCampaignSpend({
      sb: client, tenantId: "t", campaignIds: ["camp-erro", "camp-ok"], from: "2026-09-01", to: "2026-09-17",
    });

    expect(result?.has("camp-erro")).toBe(false);
    expect(result?.get("camp-ok")?.spend).toBe(10);
  });

  it("lista de campanhas vazia não consulta nada", async () => {
    const { client } = makeSupabase({});
    const result = await loadCampaignSpend({
      sb: client, tenantId: "t", campaignIds: [], from: "2026-09-01", to: "2026-09-17",
    });
    expect(result?.size).toBe(0);
    expect(metaGraphRequestMock).not.toHaveBeenCalled();
  });
});
