import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evolutionConnectionStateMock,
  evolutionSendTextMock,
  insertMock,
} = vi.hoisted(() => ({
  evolutionConnectionStateMock: vi.fn(),
  evolutionSendTextMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/lib/integrations/evolution-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/evolution-api")>();
  return {
    ...actual,
    evolutionConnectionState: evolutionConnectionStateMock,
    evolutionSendText: evolutionSendTextMock,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}));

vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByTenantId: vi.fn(async () => ({ instance_name: "system-instance" })),
}));

import { isSystemAgentReady, sendSystemNotification } from "@/lib/server/system-agent";

describe("sendSystemNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
  });

  it("does not call Evolution sendText when the system instance is not open", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "connecting" } },
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("system_instance_not_open:connecting");
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "system_instance_not_open:connecting",
      }),
    );
  });

  it("does not call Evolution when the phone has 12 digits without country code", async () => {
    const result = await sendSystemNotification("629935805744", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_number");
    expect(evolutionConnectionStateMock).not.toHaveBeenCalled();
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "invalid_number",
      }),
    );
  });

  it("does not mark sent when Evolution returns an error payload with HTTP ok", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { success: false, error: "Connection Closed" },
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("evolution_payload_success_false");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "evolution_payload_success_false",
      }),
    );
  });

  it("logs the Evolution message id when the notification is accepted", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { key: { id: "MSG123" } },
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        error: null,
        metadata: expect.objectContaining({
          evolution_connection_state: "open",
          evolution_message_id: "MSG123",
        }),
      }),
    );
  });

  it("reports ready when the system instance is open", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });

    const result = await isSystemAgentReady();

    expect(result).toEqual({
      ready: true,
      instanceName: "system-instance",
      connectionState: "open",
    });
  });

  it("reports not ready when the system instance is missing", async () => {
    const { getEvolutionInstanceByTenantId } = await import("@/lib/server/tenant-evolution-instance-db");
    vi.mocked(getEvolutionInstanceByTenantId).mockResolvedValueOnce(null);

    const result = await isSystemAgentReady();

    expect(result).toEqual({
      ready: false,
      instanceName: null,
      connectionState: "none",
    });
  });
});
