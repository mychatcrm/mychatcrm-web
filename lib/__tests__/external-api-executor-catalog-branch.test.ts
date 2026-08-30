import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listExternalApiConnectorsMock,
  queryExternalApiCatalogMock,
  executeExternalApiHttpRequestMock,
} = vi.hoisted(() => ({
  listExternalApiConnectorsMock: vi.fn(),
  queryExternalApiCatalogMock: vi.fn(),
  executeExternalApiHttpRequestMock: vi.fn(),
}));

vi.mock("@/lib/server/external-api-connectors", () => ({
  listExternalApiConnectors: listExternalApiConnectorsMock,
}));
vi.mock("@/lib/server/external-api-catalog", () => ({
  queryExternalApiCatalog: queryExternalApiCatalogMock,
}));
vi.mock("@/lib/server/external-api-http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/external-api-http")>();
  return { ...actual, executeExternalApiHttpRequest: executeExternalApiHttpRequestMock };
});
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => sbMock }));

type Row = Record<string, unknown>;
let connectorRow: Row = {};
let operationRow: Row = {};
const inserts: { table: string; payload: unknown }[] = [];

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  ["select", "eq", "update"].forEach((method) => { builder[method] = () => builder; });
  builder.maybeSingle = async () => {
    if (table === "external_api_operations") return { data: operationRow, error: null };
    return { data: null, error: null };
  };
  builder.single = async () => ({ data: connectorRow, error: null });
  builder.insert = (payload: unknown) => { inserts.push({ table, payload }); return { error: null } as never; };
  return builder;
}

const sbMock = {
  from: (table: string) => makeBuilder(table),
  rpc: async () => ({ data: [{ allowed: true, remaining: 59, resets_at: new Date().toISOString() }], error: null }),
};

import { executeAgentExternalApiLookup } from "@/lib/server/external-api-executor";

const CONNECTOR_SUMMARY = {
  id: "conn-1", name: "ERP", description: "", baseUrl: "https://api.exemplo.com/v1", authType: "none" as const,
  authHeaderName: null, authUsername: null, oauthTokenUrl: null, oauthClientId: null, environment: "production" as const,
  credentialConfigured: false, credentialMask: null, enabled: true, isPrimary: true, effective: true,
  billingStatus: "included" as const, healthStatus: "untested" as const, lastHealthAt: null, lastErrorCode: null,
  agentCount: 1, operations: [], syncEnabled: true, syncOperationKey: "listar", syncFrequencyMinutes: 360 as const,
  lastSyncAt: null, lastSyncStatus: null, lastSyncError: null, lastSyncItemCount: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

describe("executeAgentExternalApiLookup — conector com sync_enabled lê o catálogo interno", () => {
  beforeEach(() => {
    listExternalApiConnectorsMock.mockReset();
    queryExternalApiCatalogMock.mockReset();
    executeExternalApiHttpRequestMock.mockReset();
    inserts.length = 0;
    connectorRow = { id: "conn-1", tenant_id: "tenant-1", sync_enabled: true, auth_type: "none", base_url: "https://api.exemplo.com/v1/" };
    operationRow = { id: "op-1", operation_key: "listar", name: "Listar", method: "GET", path_template: "/", parameters: [], response_mapping: {}, cache_ttl_seconds: 0 };
  });

  it("nunca chama executeExternalApiHttpRequest — só o catálogo interno", async () => {
    listExternalApiConnectorsMock.mockResolvedValue({ connectors: [CONNECTOR_SUMMARY] });
    queryExternalApiCatalogMock.mockResolvedValue({ records: [{ id: "1", title: "Item", availability: null, price: null, currency: null, link: null, media: [], attributes: {} }], truncated: false });

    const result = await executeAgentExternalApiLookup({
      tenantId: "tenant-1", agentId: "agent-1", skipAgentAuthorization: true,
      request: { connectorId: "conn-1", operationKey: "listar", arguments: [] },
    });

    expect(result.ok).toBe(true);
    expect(result.data?.records).toHaveLength(1);
    expect(queryExternalApiCatalogMock).toHaveBeenCalledTimes(1);
    expect(queryExternalApiCatalogMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", connectorId: "conn-1", operationKey: "listar",
    }));
    expect(executeExternalApiHttpRequestMock).not.toHaveBeenCalled();
  });

  it("conector sem sync_enabled continua usando o caminho HTTP ao vivo, sem tocar o catálogo", async () => {
    connectorRow = { id: "conn-1", tenant_id: "tenant-1", sync_enabled: false, auth_type: "none", base_url: "https://api.exemplo.com/v1/" };
    listExternalApiConnectorsMock.mockResolvedValue({ connectors: [{ ...CONNECTOR_SUMMARY, syncEnabled: false }] });
    executeExternalApiHttpRequestMock.mockResolvedValue({ status: 200, payload: { items: [] } });

    const result = await executeAgentExternalApiLookup({
      tenantId: "tenant-1", agentId: "agent-1", skipAgentAuthorization: true,
      request: { connectorId: "conn-1", operationKey: "listar", arguments: [] },
    });

    expect(result.ok).toBe(true);
    expect(executeExternalApiHttpRequestMock).toHaveBeenCalledTimes(1);
    expect(queryExternalApiCatalogMock).not.toHaveBeenCalled();
  });
});
