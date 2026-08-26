import { describe, expect, it, vi } from "vitest";
import { filterConversationsByInboxTab } from "@/lib/conversas/inbox-filters";
import { buildConversationTimeline } from "@/lib/conversas/conversation-timeline";
import {
  canHumanSendMessage,
  deriveConversationMode,
  takeoverConversation,
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

  it("retries a takeover that loses an automation_epoch race", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "automation_epoch_stale" } })
      .mockResolvedValueOnce({
        data: {
          state: {
            id: "state-1", tenant_id: "tenant-1", remote_jid: "5511999999999@s.whatsapp.net",
            lead_id: null, agent_id: "agent-1", channel: "whatsapp", status: "active",
            human_paused: true, paused_reason: "human_takeover", paused_by: "human_manual",
            handoff_suggested: false, conversation_mode: "human", automation_epoch: 3,
          },
        },
        error: null,
      });
    let reads = 0;
    const sb = {
      rpc,
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.in = () => chain;
        chain.update = () => chain;
        chain.maybeSingle = async () => {
          reads += 1;
          return {
            data: table === "conversation_states"
              ? {
                  id: "state-1", tenant_id: "tenant-1", remote_jid: "5511999999999@s.whatsapp.net",
                  lead_id: null, agent_id: "agent-1", channel: "whatsapp", status: "active",
                  human_paused: false, conversation_mode: "automation", automation_epoch: reads > 3 ? 2 : 1,
                }
              : null,
            error: null,
          };
        };
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain;
      },
    } as never;

    const result = await takeoverConversation({
      sb, tenantId: "tenant-1", remoteJid: "5511999999999@s.whatsapp.net",
      actorId: "owner-1", actorName: "Owner", agentId: "agent-1",
    });

    expect(result.state?.conversationMode).toBe("human");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_expected_epoch: 1 });
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_expected_epoch: 2 });
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
