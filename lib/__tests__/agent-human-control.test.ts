import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertConversationStateMock = vi.fn(async () => ({
  id: "state-1",
  tenantId: "tenant-1",
  remoteJid: "5511999999999@s.whatsapp.net",
  leadId: null,
  agentId: "ag-vendas",
  channel: "whatsapp",
  status: "human_paused",
  humanPaused: true,
  pausedReason: "manual_pause_command",
  pausedBy: "human_command",
  handoffSuggested: false,
  handoffReason: null,
  lastSummaryAt: null,
}));

const maybeSingleMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: maybeSingleMock,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/server/conversation-memory", () => ({
  upsertConversationState: (...args: unknown[]) => upsertConversationStateMock(...args),
}));

describe("conversation human control", () => {
  beforeEach(async () => {
    vi.resetModules();
    upsertConversationStateMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it("pauses when inbound text matches pause command", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { metadata: { comandoPausaConversa: "pausar", comandoRetomaConversa: "retomar" } },
      error: null,
    });
    const { applyHumanConversationCommand } = await import("@/lib/server/conversation-human-control");

    const result = await applyHumanConversationCommand({
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "ag-vendas",
      text: "Pausar",
    });

    expect(result).toBe("paused");
    expect(upsertConversationStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        humanPaused: true,
        pausedBy: "human_command",
      }),
    );
  });

  it("resumes when inbound text matches resume command", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { metadata: { comandoPausaConversa: "pausar", comandoRetomaConversa: "retomar" } },
      error: null,
    });
    const { applyHumanConversationCommand } = await import("@/lib/server/conversation-human-control");

    const result = await applyHumanConversationCommand({
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "ag-vendas",
      text: "retomar",
    });

    expect(result).toBe("resumed");
    expect(upsertConversationStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        humanPaused: false,
      }),
    );
  });

  it("pauses conversation when human replies from dashboard", async () => {
    maybeSingleMock.mockResolvedValue({ data: { metadata: {} }, error: null });
    const { pauseConversationForHumanOutbound } = await import("@/lib/server/conversation-human-control");

    const result = await pauseConversationForHumanOutbound({
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "ag-vendas",
      text: "Olá, sou o atendente",
    });

    expect(result).toBe("paused");
    expect(upsertConversationStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        humanPaused: true,
        pausedBy: "human_manual",
        pausedReason: "human_takeover",
      }),
    );
  });

  it("does not pause again when resume command is sent from dashboard", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { metadata: { comandoRetomaConversa: "retomar" } },
      error: null,
    });
    const { pauseConversationForHumanOutbound } = await import("@/lib/server/conversation-human-control");

    const result = await pauseConversationForHumanOutbound({
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentId: "ag-vendas",
      text: "retomar",
    });

    expect(result).toBe("resumed");
    expect(upsertConversationStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        humanPaused: false,
      }),
    );
    expect(upsertConversationStateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        pausedBy: "human_manual",
      }),
    );
  });
});
