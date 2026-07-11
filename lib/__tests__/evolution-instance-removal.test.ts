import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evolutionRemoveInstanceCompletely } from "@/lib/integrations/evolution-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status >= 400 ? "Bad Request" : "OK",
    headers: { "Content-Type": "application/json" },
  });
}

describe("Evolution instance removal verification", () => {
  const originalBaseUrl = process.env.EVOLUTION_API_BASE_URL;
  const originalApiKey = process.env.EVOLUTION_API_KEY;

  beforeEach(() => {
    process.env.EVOLUTION_API_BASE_URL = "https://evolution.test";
    process.env.EVOLUTION_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.EVOLUTION_API_BASE_URL = originalBaseUrl;
    process.env.EVOLUTION_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it("retries DELETE without the unsupported POST fallback when inventory still contains the instance", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/instance/delete/")) {
        return jsonResponse(400, {
          error: "Bad Request",
          response: { message: [{ reason: `${init?.method ?? "GET"} rejected` }] },
        });
      }
      if (url.includes("/instance/fetchInstances")) {
        return jsonResponse(200, [{ instance: { instanceName: "mc-system-old", state: "open" } }]);
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await evolutionRemoveInstanceCompletely("mc-system-old", {
      verificationDelaysMs: [0, 0],
      retryDeleteDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.presence).toBe("present");
    expect(result.verifiedAbsent).toBe(false);
    expect(result.error).toContain("rejected");
    const deleteCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/instance/delete/"));
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls.every(([, init]) => init?.method === "DELETE")).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/instance/logout/"))).toBe(false);
  });

  it("accepts a failed delete response when inventory positively proves absence", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/instance/delete/")) return jsonResponse(500, { error: "proxy reset" });
      if (url.includes("/instance/fetchInstances")) return jsonResponse(200, []);
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await evolutionRemoveInstanceCompletely("mc-system-old", {
      verificationDelaysMs: [0],
      retryDeleteDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.presence).toBe("absent");
    expect(result.verifiedAbsent).toBe(true);
  });

  it("treats Evolution 2.3.7 filtered inventory 404 as confirmed absence", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/instance/delete/")) return jsonResponse(404, { message: "not found" });
      if (url.includes("/instance/fetchInstances")) {
        return jsonResponse(404, { message: 'Instance "mc-system-old" not found' });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await evolutionRemoveInstanceCompletely("mc-system-old", {
      verificationDelaysMs: [0],
      retryDeleteDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.presence).toBe("absent");
    expect(result.verifiedAbsent).toBe(true);
  });

  it("returns unknown when the verification inventory cannot be queried", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/instance/delete/")) return jsonResponse(200, {});
      if (url.includes("/instance/fetchInstances")) throw new Error("inventory timeout");
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await evolutionRemoveInstanceCompletely("mc-system-old", {
      verificationDelaysMs: [0, 0],
      retryDeleteDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.presence).toBe("unknown");
    expect(result.verifiedAbsent).toBe(false);
    expect(result.error).toContain("instance_removal_unverified");
  });

  it("waits for asynchronous cleanup and succeeds when the instance disappears", async () => {
    let inventoryChecks = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/instance/delete/")) return jsonResponse(200, { status: "SUCCESS" });
      if (url.includes("/instance/fetchInstances")) {
        inventoryChecks += 1;
        return inventoryChecks === 1
          ? jsonResponse(200, [{ instance: { instanceName: "mc-system-old", state: "open" } }])
          : jsonResponse(404, { message: "not found" });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await evolutionRemoveInstanceCompletely("mc-system-old", {
      verificationDelaysMs: [0, 0],
      retryDeleteDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.verifiedAbsent).toBe(true);
    expect(inventoryChecks).toBe(2);
  });
});
