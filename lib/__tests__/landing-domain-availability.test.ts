/**
 * Consulta de disponibilidade de domínio.
 *
 * Este ficheiro existe por causa de um bug real: o parser esperava
 * `{ data: [...] }` e a API devolve um ARRAY no topo, então a busca ficava
 * sempre vazia — sem erro, sem log, sem nada na tela. Um teste que só verifica
 * "não rebentou" não teria apanhado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkDomainAvailability } from "@/lib/server/landing-domains";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_TOKEN = process.env.HOSTINGER_API_TOKEN;

/** Resposta real do registador, copiada da API em 18/09/2026. */
const AVAILABILITY_ROWS = [
  { domain: "exemplo.com.br", is_available: true, is_alternative: false, restriction: "requires_cpf_or_cnpj" },
  { domain: "exemplo.com", is_available: false, is_alternative: false, restriction: null },
];

const CATALOG_ROWS = [
  {
    id: "hostingercombr-domain-combr",
    name: ".COM.BR Domain",
    category: "DOMAIN",
    prices: [
      {
        id: "hostingercombr-domain-combr-brl-1y",
        currency: "BRL",
        price: 6499,
        first_period_price: 3999,
        period: 1,
        period_unit: "year",
      },
      {
        id: "hostingercombr-domain-combr-brl-2y",
        currency: "BRL",
        price: 12998,
        first_period_price: 9498,
        period: 2,
        period_unit: "year",
      },
    ],
  },
];

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

/** `wrap` troca a forma do corpo para provar a tolerância a empacotamento. */
function mockFetch(wrap: (rows: unknown) => unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/domains/v1/availability")) return jsonResponse(wrap(AVAILABILITY_ROWS));
    if (url.includes("/api/billing/v1/catalog")) return jsonResponse(wrap(CATALOG_ROWS));
    return jsonResponse([]);
  });
}

describe("disponibilidade de domínio", () => {
  beforeEach(() => {
    process.env.HOSTINGER_API_TOKEN = "token-de-teste";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_TOKEN === undefined) delete process.env.HOSTINGER_API_TOKEN;
    else process.env.HOSTINGER_API_TOKEN = ORIGINAL_TOKEN;
    vi.restoreAllMocks();
  });

  it("lê o array devolvido no topo — a forma real da API", async () => {
    globalThis.fetch = mockFetch((rows) => rows) as unknown as typeof fetch;

    // TLD único para não reaproveitar o cache entre casos.
    const result = await checkDomainAvailability({ query: "exemplo", tlds: ["com.br"] });

    expect(result.enabled).toBe(true);
    expect(result.suggestions).toHaveLength(2);
    const disponivel = result.suggestions.find((item) => item.domain === "exemplo.com.br");
    expect(disponivel?.available).toBe(true);
    expect(disponivel?.restriction).toBe("requires_cpf_or_cnpj");
  });

  it("traz o preço do primeiro ano e o da renovação, em reais", async () => {
    globalThis.fetch = mockFetch((rows) => rows) as unknown as typeof fetch;

    const result = await checkDomainAvailability({ query: "exemplo2", tlds: ["com.br"] });
    const disponivel = result.suggestions.find((item) => item.domain === "exemplo.com.br");

    // Cêntimos viram reais, e os dois valores são diferentes de propósito.
    expect(disponivel?.firstYearBRL).toBe(39.99);
    expect(disponivel?.renewalBRL).toBe(64.99);
  });

  it("não pede preço para domínio indisponível", async () => {
    globalThis.fetch = mockFetch((rows) => rows) as unknown as typeof fetch;

    const result = await checkDomainAvailability({ query: "exemplo3", tlds: ["com.br"] });
    const indisponivel = result.suggestions.find((item) => item.domain === "exemplo.com");

    expect(indisponivel?.available).toBe(false);
    expect(indisponivel?.firstYearBRL).toBeNull();
  });

  it("continua a funcionar se a API voltar a empacotar em `data`", async () => {
    globalThis.fetch = mockFetch((rows) => ({ data: rows })) as unknown as typeof fetch;

    const result = await checkDomainAvailability({ query: "exemplo4", tlds: ["com.br"] });
    expect(result.suggestions).toHaveLength(2);
  });

  it("desliga sem token, em vez de inventar disponibilidade", async () => {
    delete process.env.HOSTINGER_API_TOKEN;
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await checkDomainAvailability({ query: "exemplo5" });

    expect(result.enabled).toBe(false);
    expect(result.suggestions).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("recusa consulta vazia sem chamar a API", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await checkDomainAvailability({ query: "!!!" });

    expect(result.suggestions).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
