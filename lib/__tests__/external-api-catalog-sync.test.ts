import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeExternalApiHttpRequestMock, logExternalApiConnectorAuditMock } = vi.hoisted(() => ({
  executeExternalApiHttpRequestMock: vi.fn(),
  logExternalApiConnectorAuditMock: vi.fn(),
}));

vi.mock("@/lib/server/external-api-http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/external-api-http")>();
  return { ...actual, executeExternalApiHttpRequest: executeExternalApiHttpRequestMock };
});
vi.mock("@/lib/server/external-api-connector-audit", () => ({
  logExternalApiConnectorAudit: logExternalApiConnectorAuditMock,
}));

type Row = Record<string, unknown>;

function makeBuilder(resultProvider: () => { data?: unknown; error: unknown }, onTerminal?: (method: string, args: unknown[]) => void) {
  const builder: Record<string, unknown> = {};
  ["select", "eq", "lt", "order", "limit"].forEach((method) => {
    builder[method] = (...args: unknown[]) => { onTerminal?.(method, args); return builder; };
  });
  builder.update = (...args: unknown[]) => { onTerminal?.("update", args); return builder; };
  builder.upsert = (...args: unknown[]) => { onTerminal?.("upsert", args); return resultProvider(); };
  builder.maybeSingle = async () => resultProvider();
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resultProvider()).then(resolve, reject);
  return builder;
}

let connectorRow: Row = {};
let operationRow: Row = {};
const upsertedBatches: Row[][] = [];
const inactivateCalls: unknown[][] = [];
const connectorUpdates: Row[] = [];

function makeSb() {
  return {
    from: (table: string) => {
      if (table === "external_api_connectors") {
        return makeBuilder(() => ({ data: connectorRow, error: null }), (method, args) => {
          if (method === "update") connectorUpdates.push(args[0] as Row);
        });
      }
      if (table === "external_api_operations") {
        return makeBuilder(() => ({ data: operationRow, error: null }));
      }
      if (table === "external_api_catalog_items") {
        return makeBuilder(() => ({ error: null }), (method, args) => {
          if (method === "upsert") upsertedBatches.push(args[0] as Row[]);
          if (method === "lt") inactivateCalls.push(args);
        });
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

import { syncExternalApiConnectorCatalog } from "@/lib/server/external-api-catalog-sync";

describe("syncExternalApiConnectorCatalog", () => {
  beforeEach(() => {
    executeExternalApiHttpRequestMock.mockReset();
    logExternalApiConnectorAuditMock.mockReset();
    upsertedBatches.length = 0;
    inactivateCalls.length = 0;
    connectorUpdates.length = 0;
    connectorRow = {
      id: "conn-1", tenant_id: "tenant-1", sync_enabled: true, sync_operation_key: "listar",
      auth_type: "none", base_url: "https://api.exemplo.com/v1/",
    };
    operationRow = {
      id: "op-1", operation_key: "listar", name: "Listar", method: "GET", path_template: "/",
      parameters: [], response_mapping: {}, pagination: { mode: "none", maxPages: 10 },
    };
  });

  it("recusa quando o conector não tem sync configurado", async () => {
    connectorRow = { ...connectorRow, sync_enabled: false };
    const result = await syncExternalApiConnectorCatalog({ sb: makeSb(), tenantId: "tenant-1", connectorId: "conn-1" });
    expect(result).toEqual({ ok: false, itemCount: 0, error: "sync_not_configured" });
    expect(executeExternalApiHttpRequestMock).not.toHaveBeenCalled();
  });

  it("uma página sem paginação: busca uma vez só, faz upsert com os itens normalizados e inativa o que sumiu", async () => {
    executeExternalApiHttpRequestMock.mockResolvedValue({
      status: 200,
      payload: { items: [{ id: "a1", title: "Item A" }, { id: "a2", title: "Item B" }] },
    });

    const result = await syncExternalApiConnectorCatalog({ sb: makeSb(), tenantId: "tenant-1", connectorId: "conn-1" });

    expect(result).toEqual({ ok: true, itemCount: 2 });
    expect(executeExternalApiHttpRequestMock).toHaveBeenCalledTimes(1);
    expect(upsertedBatches).toHaveLength(1);
    expect(upsertedBatches[0]!.map((row) => row.external_id)).toEqual(["a1", "a2"]);
    expect(upsertedBatches[0]!.every((row) => row.tenant_id === "tenant-1" && row.connector_id === "conn-1")).toBe(true);
    // Nunca DELETE — só marca is_active:false pra quem não apareceu nesta passada.
    expect(inactivateCalls).toHaveLength(1);
    expect(connectorUpdates.at(-1)).toMatchObject({ last_sync_status: "success", last_sync_item_count: 2 });
    expect(logExternalApiConnectorAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "sync_completed", detail: { itemCount: 2 } }));
  });

  it("paginação page_param respeita maxPages — nunca busca mais páginas que o configurado", async () => {
    operationRow = { ...operationRow, pagination: { mode: "page_param", pageParam: "page", maxPages: 2 } };
    executeExternalApiHttpRequestMock
      .mockResolvedValueOnce({ status: 200, payload: { items: [{ id: "p1", title: "Página 1" }] } })
      .mockResolvedValueOnce({ status: 200, payload: { items: [{ id: "p2", title: "Página 2" }] } });

    const result = await syncExternalApiConnectorCatalog({ sb: makeSb(), tenantId: "tenant-1", connectorId: "conn-1" });

    expect(result).toEqual({ ok: true, itemCount: 2 });
    expect(executeExternalApiHttpRequestMock).toHaveBeenCalledTimes(2);
    expect(upsertedBatches.flat().map((row) => row.external_id)).toEqual(["p1", "p2"]);
  });

  it("página vazia encerra a paginação antes de bater o maxPages", async () => {
    operationRow = { ...operationRow, pagination: { mode: "page_param", pageParam: "page", maxPages: 5 } };
    executeExternalApiHttpRequestMock
      .mockResolvedValueOnce({ status: 200, payload: { items: [{ id: "q1", title: "Único" }] } })
      .mockResolvedValueOnce({ status: 200, payload: { items: [] } });

    const result = await syncExternalApiConnectorCatalog({ sb: makeSb(), tenantId: "tenant-1", connectorId: "conn-1" });

    expect(result.itemCount).toBe(1);
    expect(executeExternalApiHttpRequestMock).toHaveBeenCalledTimes(2);
  });

  it("registra falha no conector e no log de auditoria quando a chamada externa falha", async () => {
    executeExternalApiHttpRequestMock.mockRejectedValue(new Error("external_api_http_error"));

    const result = await syncExternalApiConnectorCatalog({ sb: makeSb(), tenantId: "tenant-1", connectorId: "conn-1" });

    expect(result.ok).toBe(false);
    expect(connectorUpdates.at(-1)).toMatchObject({ last_sync_status: "error" });
    expect(logExternalApiConnectorAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "sync_failed" }));
  });
});
