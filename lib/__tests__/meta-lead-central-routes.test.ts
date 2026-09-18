import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCentralAccessMock,
  searchMetaLeadEventsMock,
  countMetaLeadEventsMock,
  hasArchiveSupportMock,
  loadCentralFacetsMock,
  resolveLeadOutcomesMock,
  resolveLeadIdsForOutcomesMock,
  setCentralEventsArchivedMock,
} = vi.hoisted(() => ({
  requireCentralAccessMock: vi.fn(),
  searchMetaLeadEventsMock: vi.fn(),
  countMetaLeadEventsMock: vi.fn(),
  hasArchiveSupportMock: vi.fn(),
  loadCentralFacetsMock: vi.fn(),
  resolveLeadOutcomesMock: vi.fn(),
  resolveLeadIdsForOutcomesMock: vi.fn(),
  setCentralEventsArchivedMock: vi.fn(),
}));

vi.mock("@/lib/server/meta-lead-central-guard", () => ({
  requireCentralAccess: requireCentralAccessMock,
  actorLabel: (session: { employeeId?: string }) => session.employeeId ?? "owner",
}));
vi.mock("@/lib/server/meta-lead-central", () => ({
  searchMetaLeadEvents: searchMetaLeadEventsMock,
  countMetaLeadEvents: countMetaLeadEventsMock,
  hasArchiveSupport: hasArchiveSupportMock,
  loadCentralFacets: loadCentralFacetsMock,
  CENTRAL_DEFAULT_PAGE_SIZE: 50,
  CENTRAL_MAX_PAGE_SIZE: 200,
}));
vi.mock("@/lib/server/meta-lead-outcome", () => ({
  resolveLeadOutcomes: resolveLeadOutcomesMock,
  resolveLeadIdsForOutcomes: resolveLeadIdsForOutcomesMock,
}));
vi.mock("@/lib/server/meta-lead-central-actions", () => ({
  setCentralEventsArchived: setCentralEventsArchivedMock,
}));

import { NextRequest } from "next/server";
import { GET as searchRoute } from "@/app/api/client/meta/lead-events/search/route";
import { GET as facetsRoute } from "@/app/api/client/meta/lead-events/facets/route";
import { POST as bulkRoute } from "@/app/api/client/meta/lead-events/bulk/route";

/** As rotas leem `req.nextUrl`, então o pedido tem de ser um NextRequest. */
function request(url: string, init?: RequestInit) {
  return new NextRequest(url, init as never) as never;
}

function allowOwner() {
  requireCentralAccessMock.mockResolvedValue({
    ok: true,
    session: { tenantId: "tenant-1" },
    sb: {},
    scope: { kind: "all" },
    canSeeSpend: true,
  });
}

function denySeller() {
  requireCentralAccessMock.mockResolvedValue({
    ok: false,
    response: Response.json({ error: "Sem permissão.", code: "FORBIDDEN_ROUTE" }, { status: 403 }),
  });
}

const ROW = {
  id: "event-1",
  leadgen_id: "lg-1",
  lead_id: "lead-1",
  created_at: "2026-09-17T12:00:00.000Z",
  campaign_id: "camp-1",
  current_step: "whatsapp_sent",
};

beforeEach(() => {
  requireCentralAccessMock.mockReset();
  searchMetaLeadEventsMock.mockReset();
  countMetaLeadEventsMock.mockReset();
  hasArchiveSupportMock.mockReset();
  loadCentralFacetsMock.mockReset();
  resolveLeadOutcomesMock.mockReset();
  resolveLeadIdsForOutcomesMock.mockReset();
  setCentralEventsArchivedMock.mockReset();

  hasArchiveSupportMock.mockResolvedValue(true);
  resolveLeadOutcomesMock.mockResolvedValue(new Map());
  countMetaLeadEventsMock.mockResolvedValue({ total: 1, exact: true });
  searchMetaLeadEventsMock.mockResolvedValue({ rows: [ROW], nextCursor: null, scopeApplied: false });
});

describe("GET /api/client/meta/lead-events/search", () => {
  it("recusa quem não pode abrir a Central", async () => {
    denySeller();
    const response = await searchRoute(request("https://x.test/api/client/meta/lead-events/search"));
    expect(response.status).toBe(403);
    expect(searchMetaLeadEventsMock).not.toHaveBeenCalled();
  });

  it("repassa os filtros lidos da query para a camada de dados", async () => {
    allowOwner();
    await searchRoute(
      request(
        "https://x.test/api/client/meta/lead-events/search?from=2026-09-01&to=2026-09-17&cp=camp-1&q=ana",
      ),
    );

    const [args] = searchMetaLeadEventsMock.mock.calls[0] as [
      { filters: { from: string; campaignIds: string[]; search: string } },
    ];
    expect(args.filters.from).toBe("2026-09-01");
    expect(args.filters.campaignIds).toEqual(["camp-1"]);
    expect(args.filters.search).toBe("ana");
  });

  it("limita o tamanho de página ao teto do servidor", async () => {
    allowOwner();
    await searchRoute(request("https://x.test/api/client/meta/lead-events/search?limit=99999"));
    const [args] = searchMetaLeadEventsMock.mock.calls[0] as [{ limit: number }];
    expect(args.limit).toBe(200);
  });

  /** Contar é a consulta cara: só vale na primeira página do recorte. */
  it("não conta o total ao paginar", async () => {
    allowOwner();
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: "2026-09-17T12:00:00.000Z", id: "event-1" }),
      "utf8",
    ).toString("base64url");

    await searchRoute(request(`https://x.test/api/client/meta/lead-events/search?cursor=${cursor}`));
    expect(countMetaLeadEventsMock).not.toHaveBeenCalled();
  });

  it("cursor corrompido é ignorado em vez de derrubar a página", async () => {
    allowOwner();
    const response = await searchRoute(
      request("https://x.test/api/client/meta/lead-events/search?cursor=nao-e-base64-valido"),
    );
    expect(response.status).toBe(200);
    const [args] = searchMetaLeadEventsMock.mock.calls[0] as [{ cursor: unknown }];
    expect(args.cursor).toBeNull();
  });

  it("devolve o cursor da próxima página codificado", async () => {
    allowOwner();
    searchMetaLeadEventsMock.mockResolvedValue({
      rows: [ROW],
      nextCursor: { createdAt: "2026-09-17T11:00:00.000Z", id: "event-9" },
      scopeApplied: false,
    });

    const response = await searchRoute(request("https://x.test/api/client/meta/lead-events/search"));
    const body = (await response.json()) as { nextCursor: string };
    const decoded = JSON.parse(Buffer.from(body.nextCursor, "base64url").toString("utf8")) as {
      id: string;
    };
    expect(decoded.id).toBe("event-9");
  });

  it("resolve o filtro por desfecho antes de consultar", async () => {
    allowOwner();
    resolveLeadIdsForOutcomesMock.mockResolvedValue(new Set(["lead-1"]));

    await searchRoute(request("https://x.test/api/client/meta/lead-events/search?rs=ganho"));

    expect(resolveLeadIdsForOutcomesMock).toHaveBeenCalled();
    const [args] = searchMetaLeadEventsMock.mock.calls[0] as [{ leadIdFilter: Set<string> }];
    expect(Array.from(args.leadIdFilter)).toEqual(["lead-1"]);
  });

  it("sem filtro de desfecho não paga a consulta de desfecho", async () => {
    allowOwner();
    await searchRoute(request("https://x.test/api/client/meta/lead-events/search"));
    expect(resolveLeadIdsForOutcomesMock).not.toHaveBeenCalled();
  });

  it("tabela ausente devolve lista vazia, não erro 500", async () => {
    allowOwner();
    searchMetaLeadEventsMock.mockRejectedValue(new Error("meta_lead_central_query_failed: PGRST205"));

    const response = await searchRoute(request("https://x.test/api/client/meta/lead-events/search"));
    const body = (await response.json()) as { rows: unknown[]; tableReady: boolean };
    expect(response.status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.tableReady).toBe(false);
  });

  it("nunca guarda a resposta em cache", async () => {
    allowOwner();
    const response = await searchRoute(request("https://x.test/api/client/meta/lead-events/search"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/client/meta/lead-events/facets", () => {
  it("recusa quem não pode abrir a Central", async () => {
    denySeller();
    const response = await facetsRoute(request("https://x.test/api/client/meta/lead-events/facets"));
    expect(response.status).toBe(403);
  });

  it("devolve as opções do período", async () => {
    allowOwner();
    loadCentralFacetsMock.mockResolvedValue({
      pages: [], forms: [], campaigns: [{ value: "c1", label: "Camp", count: 3 }],
      adsets: [], ads: [], agents: [], sampled: 3, truncated: false,
    });

    const response = await facetsRoute(request("https://x.test/api/client/meta/lead-events/facets"));
    const body = (await response.json()) as { campaigns: Array<{ value: string }> };
    expect(body.campaigns[0]?.value).toBe("c1");
  });
});

describe("POST /api/client/meta/lead-events/bulk", () => {
  it("recusa quem não pode abrir a Central", async () => {
    denySeller();
    const response = await bulkRoute(
      request("https://x.test/api/client/meta/lead-events/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "archive", ids: ["a"] }),
      }),
    );
    expect(response.status).toBe(403);
    expect(setCentralEventsArchivedMock).not.toHaveBeenCalled();
  });

  it("recusa ação desconhecida", async () => {
    allowOwner();
    const response = await bulkRoute(
      request("https://x.test/api/client/meta/lead-events/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "apagar_tudo", ids: ["a"] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(setCentralEventsArchivedMock).not.toHaveBeenCalled();
  });

  it("recusa lista vazia", async () => {
    allowOwner();
    const response = await bulkRoute(
      request("https://x.test/api/client/meta/lead-events/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "archive", ids: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("limita o lote e remove repetidos", async () => {
    allowOwner();
    setCentralEventsArchivedMock.mockResolvedValue({ ok: true, updated: 500 });
    const ids = [...Array.from({ length: 600 }, (_, index) => `id-${index}`), "id-0"];

    await bulkRoute(
      request("https://x.test/api/client/meta/lead-events/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "archive", ids }),
      }),
    );

    const [args] = setCentralEventsArchivedMock.mock.calls[0] as [{ eventIds: string[] }];
    expect(args.eventIds).toHaveLength(500);
    expect(new Set(args.eventIds).size).toBe(500);
  });

  it("migração pendente responde 503 com a causa", async () => {
    allowOwner();
    setCentralEventsArchivedMock.mockResolvedValue({
      ok: false, code: "schema_pending", message: "migração pendente",
    });

    const response = await bulkRoute(
      request("https://x.test/api/client/meta/lead-events/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "archive", ids: ["a"] }),
      }),
    );
    expect(response.status).toBe(503);
  });

  it("restaurar chama a mesma ação com archived=false", async () => {
    allowOwner();
    setCentralEventsArchivedMock.mockResolvedValue({ ok: true, updated: 1 });

    await bulkRoute(
      request("https://x.test/api/client/meta/lead-events/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "restore", ids: ["a"] }),
      }),
    );

    const [args] = setCentralEventsArchivedMock.mock.calls[0] as [{ archived: boolean }];
    expect(args.archived).toBe(false);
  });
});
