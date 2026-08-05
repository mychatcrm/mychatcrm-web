import { afterEach, describe, expect, it } from "vitest";
import { decryptExternalApiCredential, encryptExternalApiCredential } from "@/lib/server/external-api-crypto";
import { buildExternalApiRequest, isBlockedExternalApiIp } from "@/lib/server/external-api-http";
import { normalizeExternalApiResponse } from "@/lib/server/external-api-normalize";
import { validateExternalApiConnectorInput } from "@/lib/server/external-api-validation";

describe("external API connectors", () => {
  const oldSecret = process.env.EXTERNAL_API_CREDENTIALS_SECRET;
  afterEach(() => { process.env.EXTERNAL_API_CREDENTIALS_SECRET = oldSecret; });

  it("encrypts credentials and rejects tampered ciphertext", () => {
    process.env.EXTERNAL_API_CREDENTIALS_SECRET = "test-secret-with-at-least-thirty-two-characters";
    const encrypted = encryptExternalApiCredential({ token: "super-secret" });
    expect(encrypted.ciphertext).not.toContain("super-secret");
    expect(decryptExternalApiCredential(encrypted.ciphertext)).toEqual({ token: "super-secret" });
    expect(decryptExternalApiCredential(`${encrypted.ciphertext.slice(0, -2)}xx`)).toBeNull();
  });

  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fc00::1"])("blocks private address %s", (ip) => {
    expect(isBlockedExternalApiIp(ip)).toBe(true);
  });

  it("rejects non-HTTPS, secrets in URL and write methods", () => {
    const base = { name: "Estoque", description: "consulta", authType: "none" as const, enabled: true,
      operations: [{ operationKey: "buscar", name: "Buscar", description: "", method: "GET" as const, pathTemplate: "/items", parameters: [], responseMapping: {}, cacheTtlSeconds: 0 as const, enabled: true }] };
    expect(() => validateExternalApiConnectorInput({ ...base, baseUrl: "http://example.com" })).toThrow("external_api_https_required");
    expect(() => validateExternalApiConnectorInput({ ...base, baseUrl: "https://example.com?token=secret" })).toThrow("external_api_invalid_base_url");
    expect(() => validateExternalApiConnectorInput({ ...base, baseUrl: "https://example.com", operations: [{ ...base.operations[0], method: "DELETE" as "GET" }] })).toThrow("external_api_read_only_method_required");
  });

  it("keeps credentials in headers and only declared parameters in the request", () => {
    const operation = { operationKey: "buscar", name: "Buscar", description: "", method: "GET" as const,
      pathTemplate: "/items/{id}", parameters: [{ name: "id", in: "path" as const, type: "string" as const, required: true, description: "" },
        { name: "q", in: "query" as const, type: "string" as const, required: false, description: "" }], responseMapping: {}, cacheTtlSeconds: 0 as const, enabled: true };
    const result = buildExternalApiRequest({ baseUrl: "https://api.example.com/v1/", operation,
      args: { id: "abc", q: "teste", undeclared: "ignore" }, authType: "bearer", credential: { token: "secret" } });
    expect(result.url.toString()).toBe("https://api.example.com/v1/items/abc?q=teste");
    expect(result.url.toString()).not.toContain("secret");
    expect(result.headers.Authorization).toBe("Bearer secret");
  });

  it("normalizes arbitrary JSON without adding niche fields", () => {
    const result = normalizeExternalApiResponse({ data: [{ sku: "1", label: "Item", stock: 3, cost: 9.9 }] },
      { itemsPath: "data", id: "sku", title: "label", availability: "stock", price: "cost", attributes: {} });
    expect(result.records[0]).toMatchObject({ id: "1", title: "Item", availability: 3, price: 9.9 });
  });

  it("creates the standard list, search and detail contract when operations are omitted", () => {
    const result = validateExternalApiConnectorInput({
      name: "Sistema externo", description: "", baseUrl: "https://api.example.com/v1", authType: "none", enabled: true,
    });
    expect(result.operations.map(({ operationKey, pathTemplate }) => ({ operationKey, pathTemplate }))).toEqual([
      { operationKey: "listar", pathTemplate: "/" },
      { operationKey: "buscar", pathTemplate: "/search" },
      { operationKey: "detalhar", pathTemplate: "/{id}" },
    ]);
  });

  it("normalizes the standard HTTP/JSON contract without a manual mapping", () => {
    const result = normalizeExternalApiResponse({ items: [{ id: "a1", title: "Registro", availability: true, price: 19.9,
      currency: "BRL", link: "https://example.com/a1", media: ["https://example.com/a1.jpg"], attributes: { color: "blue" } }] }, {});
    expect(result.records[0]).toEqual({ id: "a1", title: "Registro", availability: true, price: 19.9,
      currency: "BRL", link: "https://example.com/a1", media: ["https://example.com/a1.jpg"], attributes: { color: "blue" } });
  });
});
