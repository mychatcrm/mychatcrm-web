import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  evolutionFetchInstancesMock,
  evolutionRestartInstanceMock,
  evolutionSendTextMock,
} = vi.hoisted(() => ({
  evolutionFetchInstancesMock: vi.fn(),
  evolutionRestartInstanceMock: vi.fn(),
  evolutionSendTextMock: vi.fn(),
}));

vi.mock("@/lib/integrations/evolution-api", () => ({
  evolutionFetchInstances: evolutionFetchInstancesMock,
  evolutionRestartInstance: evolutionRestartInstanceMock,
  evolutionSendText: evolutionSendTextMock,
  isEvolutionConnectionClosedError: (error: string | null | undefined) =>
    Boolean(error && /connection\s+closed/i.test(error)),
  pickEvolutionInstanceInfo: (
    list: Array<{ name: string }>,
    name: string,
  ) => list.find((item) => item.name === name) ?? null,
}));

import { sendEvolutionTextWithConnectionRecovery } from "@/lib/server/evolution-send-recovery";

const params = {
  instanceName: "instance-1",
  number: "5562999999999",
  text: "Olá",
};

describe("sendEvolutionTextWithConnectionRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not retry successful or unrelated failures", async () => {
    evolutionSendTextMock.mockResolvedValue({ ok: true, status: 200, data: {} });

    const result = await sendEvolutionTextWithConnectionRecovery(params);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.recoveryAttempted).toBe(false);
    expect(evolutionRestartInstanceMock).not.toHaveBeenCalled();
  });

  it("restarts, verifies the session and retries once on Connection Closed", async () => {
    evolutionSendTextMock
      .mockResolvedValueOnce({ ok: false, status: 500, error: "Connection Closed" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { key: { id: "msg-1" } } });
    evolutionRestartInstanceMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    evolutionFetchInstancesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ name: "instance-1", connectionStatus: "open", ownerJid: "556200000000@s.whatsapp.net" }],
    });

    const pending = sendEvolutionTextWithConnectionRecovery(params);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.restarted).toBe(true);
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(2);
  });

  it("waits for a slow restart to become authenticated before retrying", async () => {
    evolutionSendTextMock
      .mockResolvedValueOnce({ ok: false, status: 500, error: "Connection Closed" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { key: { id: "msg-1" } } });
    evolutionRestartInstanceMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    evolutionFetchInstancesMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ name: "instance-1", connectionStatus: "close", ownerJid: null }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ name: "instance-1", connectionStatus: "open", ownerJid: "556200000000@s.whatsapp.net" }],
      });

    const pending = sendEvolutionTextWithConnectionRecovery(params);
    await vi.advanceTimersByTimeAsync(4000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(evolutionFetchInstancesMock).toHaveBeenCalledTimes(2);
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the restarted session cannot be verified as open", async () => {
    evolutionSendTextMock.mockResolvedValue({ ok: false, status: 500, error: "Connection Closed" });
    evolutionRestartInstanceMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    evolutionFetchInstancesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ name: "instance-1", connectionStatus: "close", ownerJid: null }],
    });

    const pending = sendEvolutionTextWithConnectionRecovery(params);
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.error).toBe("evolution_connection_recovery_not_open");
    expect(evolutionFetchInstancesMock).toHaveBeenCalledTimes(6);
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(1);
  });
});
