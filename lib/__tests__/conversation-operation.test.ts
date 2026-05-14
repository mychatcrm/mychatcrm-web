import { describe, expect, it } from "vitest";
import { filterConversationsByInboxTab } from "@/lib/conversas/inbox-filters";
import { buildConversationTimeline } from "@/lib/conversas/conversation-timeline";
import {
  canHumanSendMessage,
  deriveConversationMode,
} from "@/lib/server/conversation-operation";

describe("conversation operation", () => {
  it("derives automation mode by default", () => {
    expect(deriveConversationMode({})).toBe("automation");
  });

  it("derives waiting_human when handoff is suggested", () => {
    expect(
      deriveConversationMode({
        handoffSuggested: true,
        humanPaused: true,
      }),
    ).toBe("waiting_human");
  });

  it("blocks human send in automation mode", () => {
    expect(canHumanSendMessage("automation")).toBe(false);
    expect(canHumanSendMessage("human")).toBe(true);
    expect(canHumanSendMessage("waiting_human")).toBe(true);
  });
});

describe("inbox filters", () => {
  const conversations = [
    { remoteJid: "1", conversation_mode: "automation" as const },
    { remoteJid: "2", conversation_mode: "human" as const },
    { remoteJid: "3", conversation_mode: "waiting_human" as const },
  ];

  it("filters automation tab", () => {
    expect(filterConversationsByInboxTab(conversations, "automation")).toHaveLength(1);
  });

  it("filters human tab", () => {
    expect(filterConversationsByInboxTab(conversations, "human")).toHaveLength(2);
  });
});

describe("conversation timeline", () => {
  it("merges events and messages chronologically", () => {
    const timeline = buildConversationTimeline(
      [{ id: "m1", created_at: "2026-05-13T12:00:00.000Z" }],
      [
        {
          id: "e1",
          event_type: "takeover",
          title: "Lead transferido da automação para João",
          detail: null,
          actor_type: "human",
          actor_id: "u1",
          actor_name: "João",
          transferred_from: "automação",
          transferred_to: "João",
          transfer_reason: "takeover",
          created_at: "2026-05-13T11:00:00.000Z",
        },
      ],
    );
    expect(timeline[0]?.kind).toBe("event");
    expect(timeline[1]?.kind).toBe("message");
  });
});
