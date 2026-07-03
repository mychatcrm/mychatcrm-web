import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evolutionSetWebhook } from "@/lib/integrations/evolution-api";

describe("evolutionSetWebhook", () => {
  const originalBaseUrl = process.env.EVOLUTION_API_BASE_URL;
  const originalApiKey = process.env.EVOLUTION_API_KEY;
  const fetchMock = vi.fn();

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

  it("uses the nested webhook contract required by Evolution 2.3.7", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await evolutionSetWebhook({
      instanceName: "system-instance",
      url: "https://www.mychatcrm.com.br/api/webhooks/evolution",
    });

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      webhook: {
        enabled: true,
        url: "https://www.mychatcrm.com.br/api/webhooks/evolution",
        byEvents: false,
        base64: true,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      },
    });
  });

  it("falls back to the legacy contract only when the nested payload is rejected", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "invalid payload" }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await evolutionSetWebhook({
      instanceName: "legacy-instance",
      url: "https://www.mychatcrm.com.br/api/webhooks/evolution",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, legacyInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(legacyInit.body))).toMatchObject({
      enabled: true,
      webhookByEvents: false,
      webhookBase64: true,
    });
  });
});
