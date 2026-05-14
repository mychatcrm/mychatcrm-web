import { describe, expect, it } from "vitest";
import {
  buildInboundRevealPatch,
  isConversationArchived,
  isConversationVisibleInInbox,
  isStaleManualAutomationPause,
  isStructuralAutomationBlock,
  shouldResetAutomationOnArchivedReopen,
} from "@/lib/server/conversation-visibility";
import type { ConversationState } from "@/lib/server/conversation-memory";

function baseState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    id: "state-1",
    tenantId: "tenant-1",
    remoteJid: "5511999999999@s.whatsapp.net",
    leadId: "lead-1",
    agentId: "ag-vendas",
    channel: "whatsapp",
    status: "human_paused",
    humanPaused: true,
    pausedReason: "manual_toggle",
    pausedBy: "human_manual",
    handoffSuggested: false,
    handoffReason: null,
    lastSummaryAt: null,
    isHidden: true,
    archivedAt: "2026-05-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("conversation visibility and archived reopen", () => {
  it("detects archived conversation by is_hidden or archived_at", () => {
    expect(isConversationArchived({ isHidden: true, archivedAt: null })).toBe(true);
    expect(isConversationArchived({ isHidden: false, archivedAt: "2026-05-01T00:00:00.000Z" })).toBe(
      true,
    );
    expect(isConversationArchived({ isHidden: false, archivedAt: null })).toBe(false);
  });

  it("hides archived conversations from inbox", () => {
    expect(
      isConversationVisibleInInbox({ isHidden: false, archivedAt: "2026-05-01T00:00:00.000Z" }),
    ).toBe(false);
    expect(isConversationVisibleInInbox({ isHidden: false, archivedAt: null })).toBe(true);
  });

  it("resets manual toggle pause when archived conversation reopens", () => {
    const previous = baseState();
    expect(shouldResetAutomationOnArchivedReopen(previous)).toBe(true);

    const patch = buildInboundRevealPatch(previous, {
      leadId: "lead-1",
      lastMessageAt: "2026-05-13T12:00:00.000Z",
    });

    expect(patch.isHidden).toBe(false);
    expect(patch.archivedAt).toBeNull();
    expect(patch.humanPaused).toBe(false);
    expect(patch.pausedBy).toBeNull();
    expect(patch.pausedReason).toBeNull();
    expect(patch.leadId).toBe("lead-1");
  });

  it("reopens archived conversation without pause unchanged when automation was active", () => {
    const previous = baseState({
      humanPaused: false,
      pausedBy: null,
      pausedReason: null,
      status: "active",
    });

    expect(shouldResetAutomationOnArchivedReopen(previous)).toBe(false);
    const patch = buildInboundRevealPatch(previous);
    expect(patch.humanPaused).toBeUndefined();
    expect(patch.isHidden).toBe(false);
  });

  it("does not reset automation for non-archived paused conversation", () => {
    const previous = baseState({
      isHidden: false,
      archivedAt: null,
    });

    expect(shouldResetAutomationOnArchivedReopen(previous)).toBe(false);
    expect(buildInboundRevealPatch(previous).humanPaused).toBeUndefined();
  });

  it("does not reset structural handoff pause on archived reopen", () => {
    const previous = baseState({
      pausedBy: "auto_handoff",
      pausedReason: "falar com humano",
      handoffSuggested: true,
      handoffReason: "falar com humano",
    });

    expect(isStructuralAutomationBlock(previous)).toBe(true);
    expect(shouldResetAutomationOnArchivedReopen(previous)).toBe(false);
    expect(buildInboundRevealPatch(previous).humanPaused).toBeUndefined();
  });

  it("does not reset explicit pause command on archived reopen", () => {
    const previous = baseState({
      pausedBy: "human_command",
      pausedReason: "manual_pause_command",
    });

    expect(isStaleManualAutomationPause(previous)).toBe(false);
    expect(shouldResetAutomationOnArchivedReopen(previous)).toBe(false);
  });

  it("identifies stale manual panel pause", () => {
    expect(
      isStaleManualAutomationPause({
        humanPaused: true,
        pausedBy: "human_manual",
        pausedReason: "manual_toggle",
      }),
    ).toBe(true);
  });
});
