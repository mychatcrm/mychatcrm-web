import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evolutionEnsureClientInstanceSettings,
  evolutionFindInstanceSettings,
} from "@/lib/integrations/evolution-api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SETTINGS = {
  rejectCall: false,
  msgCall: "",
  groupsIgnore: false,
  alwaysOnline: false,
  readMessages: false,
  readStatus: false,
  syncFullHistory: false,
  wavoipToken: "",
};

describe("Evolution client instance settings", () => {
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

  it("normalizes flat and nested settings responses", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ...SETTINGS, alwaysOnline: true }))
      .mockResolvedValueOnce(jsonResponse({ settings: SETTINGS }));

    expect(await evolutionFindInstanceSettings("mc-flat")).toEqual({ ...SETTINGS, alwaysOnline: true });
    expect(await evolutionFindInstanceSettings("mc-nested")).toEqual(SETTINGS);
  });

  it("does not write when alwaysOnline is already enabled", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ settings: { ...SETTINGS, alwaysOnline: true } }));

    const result = await evolutionEnsureClientInstanceSettings("mc-instance");

    expect(result).toEqual({ healthy: true, reapplied: false, reapplyOk: true, verified: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("writes and verifies an old instance", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ settings: SETTINGS }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ settings: { ...SETTINGS, alwaysOnline: true } }));

    const result = await evolutionEnsureClientInstanceSettings("mc-instance");

    expect(result).toEqual({ healthy: false, reapplied: true, reapplyOk: true, verified: true });
    const [setUrl, setInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(setUrl).toContain("/settings/set/mc-instance");
    expect(JSON.parse(String(setInit.body))).toEqual({ ...SETTINGS, alwaysOnline: true });
  });

  it("fails closed when the write or read-back fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ settings: SETTINGS }))
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503));

    expect(await evolutionEnsureClientInstanceSettings("mc-instance")).toEqual({
      healthy: false,
      reapplied: true,
      reapplyOk: false,
      verified: false,
    });

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ settings: SETTINGS }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503));
    expect(await evolutionEnsureClientInstanceSettings("mc-instance")).toMatchObject({
      reapplyOk: true,
      verified: false,
    });
  });

  it("does not guess required values when the current settings cannot be read completely", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ alwaysOnline: false }));

    expect(await evolutionEnsureClientInstanceSettings("mc-instance")).toEqual({
      healthy: false,
      reapplied: false,
      reapplyOk: false,
      verified: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
