import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evolutionEnsureWebhook,
  evolutionFindWebhook,
  isEvolutionWebhookHealthy,
} from "@/lib/integrations/evolution-api";

const EXPECTED_URL = "https://www.mychatcrm.com.br/api/webhooks/evolution?token=secret";
const EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("evolutionFindWebhook / isEvolutionWebhookHealthy / evolutionEnsureWebhook", () => {
  const fetchMock = vi.fn();
  const originalBaseUrl = process.env.EVOLUTION_API_BASE_URL;
  const originalApiKey = process.env.EVOLUTION_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVOLUTION_API_BASE_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env.EVOLUTION_API_BASE_URL = originalBaseUrl;
    process.env.EVOLUTION_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it("parses the v2 nested webhook config shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ webhook: { enabled: true, url: EXPECTED_URL, events: EVENTS } }),
    );

    const config = await evolutionFindWebhook("mc-instance");

    expect(config).toEqual({ enabled: true, url: EXPECTED_URL, events: EVENTS });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/webhook/find/mc-instance");
  });

  it("parses the flat legacy webhook config shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: true, url: EXPECTED_URL, events: EVENTS }));

    const config = await evolutionFindWebhook("mc-instance");

    expect(config).toEqual({ enabled: true, url: EXPECTED_URL, events: EVENTS });
  });

  it("returns null when Evolution has no webhook registered (404)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));

    expect(await evolutionFindWebhook("mc-instance")).toBeNull();
  });

  it("only treats a config as healthy when enabled, URL matches and MESSAGES_UPSERT is subscribed", () => {
    expect(isEvolutionWebhookHealthy({ enabled: true, url: EXPECTED_URL, events: EVENTS }, EXPECTED_URL)).toBe(true);
    expect(isEvolutionWebhookHealthy(null, EXPECTED_URL)).toBe(false);
    expect(isEvolutionWebhookHealthy({ enabled: false, url: EXPECTED_URL, events: EVENTS }, EXPECTED_URL)).toBe(false);
    expect(
      isEvolutionWebhookHealthy({ enabled: true, url: "https://outra-url.com/hook", events: EVENTS }, EXPECTED_URL),
    ).toBe(false);
    expect(
      isEvolutionWebhookHealthy({ enabled: true, url: EXPECTED_URL, events: ["CONNECTION_UPDATE"] }, EXPECTED_URL),
    ).toBe(false);
  });

  it("does not re-apply when the current config is healthy", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ webhook: { enabled: true, url: EXPECTED_URL, events: EVENTS } }),
    );

    const result = await evolutionEnsureWebhook({ instanceName: "mc-instance", url: EXPECTED_URL });

    expect(result).toEqual({ healthy: true, reapplied: false, reapplyOk: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-applies the webhook when the config is missing or wrong", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ enabled: true }, 201))
      .mockResolvedValueOnce(
        jsonResponse({ webhook: { enabled: true, url: EXPECTED_URL, events: EVENTS } }),
      );

    const result = await evolutionEnsureWebhook({ instanceName: "mc-instance", url: EXPECTED_URL });

    expect(result).toEqual({ healthy: false, reapplied: true, reapplyOk: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [setUrl, setInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(setUrl).toContain("/webhook/set/mc-instance");
    expect(JSON.parse(String(setInit.body))).toMatchObject({
      webhook: { enabled: true, url: EXPECTED_URL, events: EVENTS },
    });
  });
});
