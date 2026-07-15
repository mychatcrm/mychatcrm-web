import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInternalApiToken, verifyInternalApiRequest } from "@/lib/server/internal-api-auth";

const ENV_KEYS = [
  "INTERNAL_API_TOKEN",
  "AGENT_RESPONSE_JOBS_SECRET",
  "CRON_SECRET",
  "EVOLUTION_WEBHOOK_SECRET",
] as const;

function req(headers: Record<string, string>): Request {
  return new Request("https://x.test/api/internal/process-agenda-notifications", { headers });
}

describe("verifyInternalApiRequest", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    vi.restoreAllMocks();
  });

  it("aceita CRON_SECRET mesmo quando INTERNAL_API_TOKEN também existe (valores diferentes)", () => {
    process.env.INTERNAL_API_TOKEN = "internal-abc";
    process.env.CRON_SECRET = "cron-xyz";
    // A Vercel Cron envia o CRON_SECRET no Authorization.
    expect(verifyInternalApiRequest(req({ authorization: "Bearer cron-xyz" }))).toBe(true);
    // getInternalApiToken (assinatura de saída) mantém a prioridade.
    expect(getInternalApiToken()).toBe("internal-abc");
  });

  it("aceita INTERNAL_API_TOKEN via x-internal-token", () => {
    process.env.INTERNAL_API_TOKEN = "internal-abc";
    process.env.CRON_SECRET = "cron-xyz";
    expect(verifyInternalApiRequest(req({ "x-internal-token": "internal-abc" }))).toBe(true);
  });

  it("token inválido recebe 401 (retorna false)", () => {
    process.env.INTERNAL_API_TOKEN = "internal-abc";
    expect(verifyInternalApiRequest(req({ authorization: "Bearer errado" }))).toBe(false);
  });

  it("ausência de todos os secrets nunca autentica", () => {
    expect(verifyInternalApiRequest(req({ authorization: "Bearer qualquer" }))).toBe(false);
  });

  it("valores vazios não autenticam", () => {
    process.env.INTERNAL_API_TOKEN = "   ";
    expect(verifyInternalApiRequest(req({ authorization: "Bearer " }))).toBe(false);
    expect(verifyInternalApiRequest(req({ "x-internal-token": "" }))).toBe(false);
  });

  it("não registra nenhum segredo em log", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.CRON_SECRET = "cron-secreto-123";
    verifyInternalApiRequest(req({ authorization: "Bearer cron-secreto-123" }));
    const printed = [...spy.mock.calls, ...warn.mock.calls].flat().join(" ");
    expect(printed).not.toContain("cron-secreto-123");
  });
});
