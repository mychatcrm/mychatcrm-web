import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evolutionConnectionStateMock,
  evolutionFetchInstancesMock,
  evolutionRestartInstanceMock,
  evolutionSendTextMock,
  insertMock,
} = vi.hoisted(() => ({
  evolutionConnectionStateMock: vi.fn(),
  evolutionFetchInstancesMock: vi.fn(),
  evolutionRestartInstanceMock: vi.fn(),
  evolutionSendTextMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/lib/server/evolution-presence", () => ({
  sendPresence: vi.fn(async () => undefined),
  typingDelayMs: (text: string) => Math.min(8000, Math.max(2000, text.length * 50)),
}));

vi.mock("@/lib/integrations/evolution-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/evolution-api")>();
  return {
    ...actual,
    evolutionConnectionState: evolutionConnectionStateMock,
    evolutionFetchInstances: evolutionFetchInstancesMock,
    evolutionRestartInstance: evolutionRestartInstanceMock,
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
  getEvolutionInstanceByTenantSlot: vi.fn(async () => null),
}));

import { isSystemAgentReady, sendSystemNotification } from "@/lib/server/system-agent";

describe("sendSystemNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "log-test-id" }, error: null }),
      }),
    });
    evolutionRestartInstanceMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    // Default: sessão realmente autenticada (open + ownerJid) para os caminhos felizes.
    evolutionFetchInstancesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          name: "system-instance",
          connectionStatus: "open",
          ownerJid: "556282067910@s.whatsapp.net",
          profileName: "MyChatCRM",
        },
      ],
    });
  });

  it("does not call Evolution sendText when the system instance is not open", async () => {
    evolutionFetchInstancesMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [
        {
          name: "system-instance",
          connectionStatus: "connecting",
          ownerJid: null,
          profileName: null,
        },
      ],
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("system_session_not_authenticated:connecting");
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "system_session_not_authenticated:connecting",
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
    evolutionSendTextMock.mockResolvedValue({
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

  it("sends platform number with 9 first (conversas style)", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { key: { id: "MSGX" }, status: "PENDING" },
    });

    const result = await sendSystemNotification("5562993580574", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(true);
    expect(evolutionSendTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ number: "5562993580574" }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        to_number: "5562993580574",
        metadata: expect.objectContaining({
          number_normalized: "5562993580574",
          number_sent: "5562993580574",
          evolution_number_check: "conversas_style",
        }),
      }),
    );
  });

  it("sends once for critical notifications when Evolution returns PENDING (no double send)", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { key: { id: "MSG_NO_9" }, status: "PENDING" },
    });

    const result = await sendSystemNotification("5562993580574", "Teste", "system-instance", {
      type: "phone_verification_code",
    });

    expect(result.ok).toBe(true);
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(1);
    expect(evolutionSendTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ number: "5562993580574" }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        metadata: expect.objectContaining({
          evolution_message_id: "MSG_NO_9",
          evolution_message_ids: ["MSG_NO_9"],
        }),
      }),
    );
  });

  it("uses conversas_style for admin_test without pre-checking whatsappNumbers", async () => {
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { key: { id: "FAST1" }, status: "PENDING" },
    });

    await sendSystemNotification("5562993580574", "Teste", "system-instance", {
      type: "admin_test",
    });

    expect(evolutionSendTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ number: "5562993580574" }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ evolution_number_check: "conversas_style" }),
      }),
    );
  });

  it("does not retry with alternate Brazilian format when Evolution omits message id", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { status: "PENDING" },
    });

    const result = await sendSystemNotification("5562993580574", "Teste", "system-instance", {
      type: "phone_verification_code",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_evolution_message_id");
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(1);
    expect(evolutionSendTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ number: "5562993580574" }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "missing_evolution_message_id",
      }),
    );
  });

  it("logs sent when Evolution returns SERVER_ACK (numeric 2)", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { key: { id: "MSG_ACK" }, status: 2 },
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        metadata: expect.objectContaining({ evolution_message_id: "MSG_ACK" }),
      }),
    );
  });

  it("does not send when fetchInstances fails (fail closed)", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionFetchInstancesMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "Evolution unavailable",
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "admin_test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("system_session_check_failed");
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
  });

  it("sends once for handoff_alert when Evolution returns numeric PENDING (1)", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { key: { id: "H1" }, status: 1 },
    });

    const result = await sendSystemNotification("5562993580574", "Handoff", "system-instance", {
      type: "handoff_alert",
    });

    expect(result.ok).toBe(true);
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        metadata: expect.objectContaining({
          evolution_message_id: "H1",
          evolution_message_ids: ["H1"],
        }),
      }),
    );
  });

  it("does not mark sent when Evolution accepts without returning a message id", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValue({
      ok: true,
      status: 201,
      data: { status: "PENDING" },
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_evolution_message_id");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "missing_evolution_message_id",
      }),
    );
  });

  it("restarts the session and retries when Evolution reports Connection Closed", async () => {
    evolutionConnectionStateMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { instance: { state: "open" } },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { instance: { state: "open" } },
      });
    evolutionSendTextMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: "Bad Request — Error: Connection Closed",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: { key: { id: "MSGZ" } },
      });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(true);
    expect(evolutionRestartInstanceMock).toHaveBeenCalledWith("system-instance");
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(2);
  });

  it("does not send when the session is open but has no owner (zombie session)", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionFetchInstancesMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [{ name: "system-instance", connectionStatus: "open", ownerJid: null, profileName: null }],
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "admin_test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("system_session_not_authenticated:no_owner");
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "system_session_not_authenticated:no_owner",
      }),
    );
  });

  it("does not send when the session reports a non-open connection status", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionFetchInstancesMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [{ name: "system-instance", connectionStatus: "connecting", ownerJid: null, profileName: null }],
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "admin_test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("system_session_not_authenticated:connecting");
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
  });

  it("attempts send even when whatsappNumbers would report not found", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValue({
      ok: true,
      status: 201,
      data: { status: "PENDING" },
    });

    const result = await sendSystemNotification("5562993580574", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_evolution_message_id");
    expect(evolutionSendTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ number: "5562993580574" }),
    );
  });

  it("sends with the normalized platform number (conversas style)", async () => {
    evolutionConnectionStateMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { instance: { state: "open" } },
    });
    evolutionSendTextMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { key: { id: "MSGY" } },
    });

    const result = await sendSystemNotification("62999991111", "Teste", "system-instance", {
      type: "test",
    });

    expect(result.ok).toBe(true);
    expect(evolutionSendTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ number: "5562999991111" }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        metadata: expect.objectContaining({ evolution_number_check: "conversas_style" }),
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
