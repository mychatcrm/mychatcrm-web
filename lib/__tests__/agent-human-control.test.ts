import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertConversationStateMock = vi.fn(async () => ({
  id: "state-1",
  tenantId: "tenant-1",
  remoteJid: "5511999999999@s.whatsapp.net",
  leadId: null,
  agentId: "ag-vendas",
  channel: "whatsapp",
  status: "active",
  humanPaused: false,
  pausedReason: null,
  pausedBy: null,
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

  it("pauses only on exact configured pause command", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { metadata: { comandoPausaConversa: "pausar", comandoRetomaConversa: "retomar" } },
      error: null,
    });
    const { applyHumanConversationCommand } = await import("@/lib/server/conversation-human-control");

    expect(
      await applyHumanConversationCommand({
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "ag-vendas",
        text: "oi",
      }),
    ).toBe("none");

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

  it("does not pause on common interest messages", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { metadata: { comandoPausaConversa: "pausar" } },
      error: null,
    });
    const { applyHumanConversationCommand } = await import("@/lib/server/conversation-human-control");

    expect(
      await applyHumanConversationCommand({
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "ag-vendas",
        text: "tenho interesse",
      }),
    ).toBe("none");
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

  it("toggle disables automation for one conversation", async () => {
    const { setConversationAutomationEnabled } = await import("@/lib/server/conversation-human-control");

    await setConversationAutomationEnabled({
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      enabled: false,
      agentId: "ag-vendas",
    });

    expect(upsertConversationStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        humanPaused: true,
        pausedBy: "human_manual",
        pausedReason: "manual_toggle",
      }),
    );
  });

  it("toggle re-enables automation and clears pause flags", async () => {
    const { setConversationAutomationEnabled } = await import("@/lib/server/conversation-human-control");

    await setConversationAutomationEnabled({
      tenantId: "tenant-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      enabled: true,
      agentId: "ag-vendas",
    });

    expect(upsertConversationStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        humanPaused: false,
        pausedBy: null,
        pausedReason: null,
        handoffSuggested: false,
        handoffReason: null,
      }),
    );
  });

  it("treats missing state as automation enabled", async () => {
    const { isConversationAutomationEnabled } = await import("@/lib/server/conversation-human-control");
    expect(isConversationAutomationEnabled(null)).toBe(true);
    expect(
      isConversationAutomationEnabled({
        id: "s",
        tenantId: "t",
        remoteJid: "j",
        leadId: null,
        agentId: null,
        channel: "whatsapp",
        status: "human_paused",
        humanPaused: true,
        pausedReason: "manual_toggle",
        pausedBy: "human_manual",
        handoffSuggested: false,
        handoffReason: null,
        lastSummaryAt: null,
        isHidden: false,
        archivedAt: null,
      }),
    ).toBe(false);
  });
});

describe("webhook automation gate", () => {
  it("skips agent when human_paused is true", async () => {
    const { isConversationAutomationEnabled } = await import("@/lib/server/conversation-human-control");
    const paused = {
      id: "s",
      tenantId: "t",
      remoteJid: "5511999999999@s.whatsapp.net",
      leadId: null,
      agentId: "ag-vendas",
      channel: "whatsapp",
      status: "human_paused",
      humanPaused: true,
      pausedReason: "manual_toggle",
      pausedBy: "human_manual",
      handoffSuggested: false,
      handoffReason: null,
      lastSummaryAt: null,
      isHidden: false,
      archivedAt: null,
    };
    expect(isConversationAutomationEnabled(paused)).toBe(false);
  });

  it("allows agent when automation is enabled", async () => {
    const { isConversationAutomationEnabled } = await import("@/lib/server/conversation-human-control");
    const active = {
      id: "s",
      tenantId: "t",
      remoteJid: "5511999999999@s.whatsapp.net",
      leadId: null,
      agentId: "ag-vendas",
      channel: "whatsapp",
      status: "active",
      humanPaused: false,
      pausedReason: null,
      pausedBy: null,
      handoffSuggested: false,
      handoffReason: null,
      lastSummaryAt: null,
      isHidden: false,
      archivedAt: null,
    };
    expect(isConversationAutomationEnabled(active)).toBe(true);
  });
});
