import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => sbMock,
}));

type Row = Record<string, unknown>;

let cachedRow: Row | null = null;
let upsertedRows: Row[] = [];

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = ["select", "eq"];
  chain.forEach((method) => { builder[method] = () => builder; });
  builder.maybeSingle = async () => ({ data: table === "external_api_oauth_tokens" ? cachedRow : null, error: null });
  builder.upsert = (rows: Row | Row[]) => {
    upsertedRows.push(...(Array.isArray(rows) ? rows : [rows]));
    return { error: null };
  };
  return builder;
}

const sbMock = { from: (table: string) => makeBuilder(table) };

import { getValidOAuthAccessToken } from "@/lib/server/external-api-oauth";

describe("getValidOAuthAccessToken", () => {
  const oldSecret = process.env.EXTERNAL_API_CREDENTIALS_SECRET;
  const oldFetch = global.fetch;

  beforeEach(() => {
    process.env.EXTERNAL_API_CREDENTIALS_SECRET = "test-secret-with-at-least-thirty-two-characters";
    cachedRow = null;
    upsertedRows = [];
  });
  afterEach(() => {
    process.env.EXTERNAL_API_CREDENTIALS_SECRET = oldSecret;
    global.fetch = oldFetch;
  });

  const config = {
    connectorId: "conn-1",
    tenantId: "tenant-1",
    tokenUrl: "https://api.exemplo.com/oauth/token",
    clientId: "client-id-1",
    clientSecret: "client-secret-1",
  };

  it("busca um token novo via client_credentials quando não há nada em cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "fresh-token", expires_in: 3600 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await getValidOAuthAccessToken(config);

    expect(token).toBe("fresh-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(config.tokenUrl);
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=client_credentials");
    expect(String(init.body)).toContain("client_secret=client-secret-1");

    // Nunca grava o token em texto puro.
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0]!.access_token_ciphertext).not.toContain("fresh-token");
  });

  it("reusa o token em cache quando falta mais de 5 minutos pro vencimento", async () => {
    const { encryptExternalApiCredential } = await import("@/lib/server/external-api-crypto");
    const encrypted = encryptExternalApiCredential({ token: "cached-token" });
    cachedRow = {
      access_token_ciphertext: encrypted.ciphertext,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await getValidOAuthAccessToken(config);

    expect(token).toBe("cached-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renova quando o token em cache vence em menos de 5 minutos", async () => {
    const { encryptExternalApiCredential } = await import("@/lib/server/external-api-crypto");
    const encrypted = encryptExternalApiCredential({ token: "quase-vencido" });
    cachedRow = {
      access_token_ciphertext: encrypted.ciphertext,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "renovado", expires_in: 3600 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await getValidOAuthAccessToken(config);

    expect(token).toBe("renovado");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bloqueia token_url apontando pra rede privada — mesma política de SSRF do resto do módulo", async () => {
    await expect(getValidOAuthAccessToken({ ...config, tokenUrl: "https://169.254.169.254/token" }))
      .rejects.toThrow("external_api_oauth_private_host_blocked");
  });

  it("propaga erro quando o endpoint de token responde com falha", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    await expect(getValidOAuthAccessToken(config)).rejects.toThrow("external_api_oauth_token_http_401");
  });
});
