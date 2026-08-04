import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServiceClientMock } = vi.hoisted(() => ({
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import {
  listCrmFunnelsFromDb,
  replaceCrmFunnelsInDb,
  seedCrmFunnelsIfEmpty,
} from "@/lib/server/crm-funnels-db";

type FunnelRow = {
  funnel_id: string;
  nome: string;
  columns: unknown;
  position?: number;
};

type Call =
  | { type: "upsert"; rows: Array<Record<string, unknown>> }
  | { type: "delete"; ids: string[] };

function makeSupabaseMock(opts: {
  rows?: FunnelRow[];
  selectError?: { code?: string; message?: string } | null;
  upsertError?: { code?: string; message?: string } | null;
}) {
  const calls: Call[] = [];
  let rows = [...(opts.rows ?? [])];

  const client = {
    from() {
      return {
        select(columns: string) {
          const chain = {
            eq: () => chain,
            order: () => chain,
            then(resolve: (value: { data: unknown; error: unknown }) => void) {
              if (opts.selectError) {
                resolve({ data: null, error: opts.selectError });
                return;
              }
              // A poda relê só os ids antes de apagar.
              const data = columns.includes("nome") ? rows : rows.map((r) => ({ funnel_id: r.funnel_id }));
              resolve({ data, error: null });
            },
          };
          return chain;
        },
        upsert(payload: Array<Record<string, unknown>>) {
          calls.push({ type: "upsert", rows: payload });
          if (!opts.upsertError) {
            // Semântica de upsert: mescla por funnel_id, não substitui a tabela.
            // A poda é quem remove o que saiu da lista.
            for (const row of payload) {
              const next = {
                funnel_id: String(row.funnel_id),
                nome: String(row.nome),
                columns: row.columns,
                position: Number(row.position ?? 0),
              };
              const index = rows.findIndex((r) => r.funnel_id === next.funnel_id);
              if (index >= 0) rows[index] = next;
              else rows.push(next);
            }
          }
          return Promise.resolve({ error: opts.upsertError ?? null });
        },
        delete() {
          const chain = {
            eq: () => chain,
            in(_column: string, ids: string[]) {
              calls.push({ type: "delete", ids });
              rows = rows.filter((r) => !ids.includes(r.funnel_id));
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };

  createSupabaseServiceClientMock.mockReturnValue(client);
  return { calls, currentRows: () => rows };
}

beforeEach(() => {
  createSupabaseServiceClientMock.mockReset();
});

describe("listCrmFunnelsFromDb", () => {
  it("reads the tenant funnels", async () => {
    makeSupabaseMock({
      rows: [{ funnel_id: "funil-default", nome: "Funil Principal", columns: [{ id: "novo", title: "Novo" }] }],
    });

    const funnels = await listCrmFunnelsFromDb("tenant-a");
    expect(funnels).toHaveLength(1);
    expect(funnels[0]!.id).toBe("funil-default");
    expect(funnels[0]!.nome).toBe("Funil Principal");
  });

  it("drops rows without a usable id or name instead of surfacing junk", async () => {
    makeSupabaseMock({
      rows: [
        { funnel_id: "   ", nome: "Sem id", columns: [] },
        { funnel_id: "ok", nome: "   ", columns: [] },
        { funnel_id: "bom", nome: "Bom", columns: [{ id: "novo", title: "Novo" }] },
      ],
    });

    const funnels = await listCrmFunnelsFromDb("tenant-a");
    expect(funnels.map((f) => f.id)).toEqual(["bom"]);
  });

  it("returns an empty list when the query fails", async () => {
    makeSupabaseMock({ selectError: { code: "42P01", message: "relation does not exist" } });
    expect(await listCrmFunnelsFromDb("tenant-a")).toEqual([]);
  });
});

describe("replaceCrmFunnelsInDb", () => {
  it("refuses an empty list so a bad payload cannot wipe the CRM", async () => {
    const { calls } = makeSupabaseMock({ rows: [{ funnel_id: "funil-default", nome: "Principal", columns: [] }] });

    const result = await replaceCrmFunnelsInDb({ tenantId: "tenant-a", funnels: [] });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("prunes only the funnels that left the list", async () => {
    const { calls } = makeSupabaseMock({
      rows: [
        { funnel_id: "funil-default", nome: "Principal", columns: [] },
        { funnel_id: "funil-antigo", nome: "Antigo", columns: [] },
      ],
    });

    const result = await replaceCrmFunnelsInDb({
      tenantId: "tenant-a",
      funnels: [{ id: "funil-default", nome: "Principal", columns: [{ id: "novo", title: "Novo" }] }],
    });

    expect(result.ok).toBe(true);
    const deletes = calls.filter((c): c is Extract<Call, { type: "delete" }> => c.type === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.ids).toEqual(["funil-antigo"]);
  });

  it("does not delete anything when the upsert failed", async () => {
    const { calls } = makeSupabaseMock({
      rows: [{ funnel_id: "funil-antigo", nome: "Antigo", columns: [] }],
      upsertError: { code: "23505", message: "conflict" },
    });

    const result = await replaceCrmFunnelsInDb({
      tenantId: "tenant-a",
      funnels: [{ id: "funil-novo", nome: "Novo", columns: [{ id: "novo", title: "Novo" }] }],
    });

    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.type === "delete")).toBe(false);
  });

  it("keeps the list order as the funnel position", async () => {
    const { calls } = makeSupabaseMock({ rows: [] });

    await replaceCrmFunnelsInDb({
      tenantId: "tenant-a",
      funnels: [
        { id: "a", nome: "A", columns: [{ id: "novo", title: "Novo" }] },
        { id: "b", nome: "B", columns: [{ id: "novo", title: "Novo" }] },
      ],
    });

    const upsert = calls.find((c): c is Extract<Call, { type: "upsert" }> => c.type === "upsert");
    expect(upsert!.rows.map((r) => [r.funnel_id, r.position])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });
});

describe("seedCrmFunnelsIfEmpty", () => {
  it("seeds the browser funnels when the tenant has none on the server", async () => {
    const { calls } = makeSupabaseMock({ rows: [] });

    const result = await seedCrmFunnelsIfEmpty({
      tenantId: "tenant-a",
      funnels: [{ id: "funil-meu", nome: "Meu funil", columns: [{ id: "novo", title: "Novo" }] }],
    });

    expect(result.seeded).toBe(true);
    expect(calls.some((c) => c.type === "upsert")).toBe(true);
  });

  it("never overwrites what the server already has", async () => {
    const { calls } = makeSupabaseMock({
      rows: [{ funnel_id: "funil-servidor", nome: "Do servidor", columns: [{ id: "novo", title: "Novo" }] }],
    });

    const result = await seedCrmFunnelsIfEmpty({
      tenantId: "tenant-a",
      funnels: [{ id: "funil-local", nome: "Do navegador", columns: [{ id: "novo", title: "Novo" }] }],
    });

    expect(result.seeded).toBe(false);
    expect(result.funnels.map((f) => f.id)).toEqual(["funil-servidor"]);
    expect(calls).toHaveLength(0);
  });
});
