import { beforeEach, describe, expect, it, vi } from "vitest";

const evolutionFetchJsonMock = vi.fn();

vi.mock("@/lib/integrations/evolution-api", () => ({
  evolutionFetchJson: (...args: unknown[]) => evolutionFetchJsonMock(...args),
}));

import { sendPresence } from "@/lib/server/evolution-presence";

describe("Evolution presence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evolutionFetchJsonMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  });

  it("envia presence e delay na raiz do payload exigido pela Evolution v2", async () => {
    await sendPresence("instance-1", "5511999999999", "composing", 4200);

    expect(evolutionFetchJsonMock).toHaveBeenCalledTimes(1);
    const [, init] = evolutionFetchJsonMock.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      number: "5511999999999",
      presence: "composing",
      delay: 4200,
    });
  });

  it("não adiciona sleep local depois da resposta da API", async () => {
    vi.useFakeTimers();
    try {
      const completed = vi.fn();
      const promise = sendPresence("instance-1", "5511999999999", "composing", 8000)
        .then(completed);
      await Promise.resolve();
      await promise;
      expect(completed).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
