import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evolutionFindMessageStatus,
  evolutionSendText,
} from "@/lib/integrations/evolution-api";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Evolution persisted message status", () => {
  beforeEach(() => {
    process.env.EVOLUTION_API_BASE_URL = "https://evolution.example";
    process.env.EVOLUTION_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.EVOLUTION_API_BASE_URL;
    delete process.env.EVOLUTION_API_KEY;
  });

  it("reads MessageUpdate by provider message id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{
      keyId: "MSG-1",
      status: "ERROR",
      remoteJid: "5562999999999@s.whatsapp.net",
      fromMe: true,
    }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await evolutionFindMessageStatus({
      instanceName: "instance-1",
      messageId: "MSG-1",
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        keyId: "MSG-1",
        status: "ERROR",
        remoteJid: "5562999999999@s.whatsapp.net",
        fromMe: true,
      },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://evolution.example/chat/findStatusMessage/instance-1",
    );
  });

  it("turns HTTP success into failure only after an explicit MessageUpdate ERROR", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        key: { id: "MSG-2", remoteJid: "5562999999999@s.whatsapp.net" },
        status: "PENDING",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        keyId: "MSG-2",
        status: "ERROR",
        remoteJid: "5562999999999@s.whatsapp.net",
        fromMe: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const pending = evolutionSendText({
      instanceName: "instance-1",
      number: "5562999999999",
      text: "Olá",
    });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;

    expect(result).toEqual({ ok: false, status: 502, error: "evolution_delivery_error" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
