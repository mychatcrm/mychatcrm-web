import { describe, expect, it, vi } from "vitest";
import { findOrphanConversations } from "@/lib/server/crm-conversation-consistency";

function supabaseQueryChain<T>(rows: T[]) {
  const result = { data: rows, error: null as null };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    limit: () => Promise.resolve(result),
  };
  chain.then = (onFulfilled: (v: typeof result) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

describe("findOrphanConversations", () => {
  it("detecta conversation_state sem lead_id", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "conversation_states") {
          return supabaseQueryChain([{ id: "s1", remote_jid: "556299@test", lead_id: null }]);
        }
        if (table === "whatsapp_messages") {
          return supabaseQueryChain([]);
        }
        if (table === "leads") {
          return supabaseQueryChain([]);
        }
        if (table === "agent_response_jobs") {
          return supabaseQueryChain([]);
        }
        return supabaseQueryChain([]);
      }),
    } as never;

    const report = await findOrphanConversations({ sb, tenantId: "tenant-1" });
    expect(report.issues.some((i) => i.kind === "state_without_lead")).toBe(true);
    expect(report.counts.state_without_lead).toBe(1);
  });
});
