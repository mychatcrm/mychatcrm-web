import { describe, expect, it, vi } from "vitest";
import {
  markAgentOutboundFailed,
  markAgentOutboundSent,
  prepareAgentOutbound,
} from "@/lib/server/agent-outbound-outbox";
import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";

const job: AgentResponseJobRow = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  tenant_id: "tenant-1",
  lead_id: null,
  journey_id: null,
  remote_jid: "5511999999999@s.whatsapp.net",
  agent_id: "agent-1",
  instance_name: "instance-1",
  channel: "evolution",
  connection_id: "connection-1",
  status: "processing",
  first_message_at: "2026-07-16T10:00:00.000Z",
  last_message_at: "2026-07-16T10:00:00.000Z",
  scheduled_for: "2026-07-16T10:00:00.000Z",
  max_wait_until: "2026-07-16T10:01:00.000Z",
  message_ids: ["223e4567-e89b-42d3-a456-426614174000"],
  inbound_message_count: 1,
  attempt_count: 1,
  burst_generation: 1,
  locked_at: "2026-07-16T10:00:00.000Z",
  claim_token: "323e4567-e89b-42d3-a456-426614174000",
  claim_expires_at: "2026-07-16T10:03:00.000Z",
  completed_at: null,
  failed_reason: null,
  created_at: "2026-07-16T10:00:00.000Z",
  updated_at: "2026-07-16T10:00:00.000Z",
};

function makeSb(initial?: Record<string, unknown>) {
  let row: Record<string, unknown> | null = initial ? { ...initial } : null;
  const sb = {
    from: () => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const chain: Record<string, unknown> = {};
      chain.upsert = async (value: Record<string, unknown>) => {
        if (!row) row = { id: "outbound-1", attempts: 0, claim_token: null, claim_expires_at: null, provider_message_id: null, ...value };
        return { error: null };
      };
      chain.select = () => chain;
      chain.eq = (key: string, value: unknown) => { filters[key] = value; return chain; };
      chain.in = (key: string, value: unknown) => { filters[`in_${key}`] = value; return chain; };
      chain.single = async () => ({ data: row ? { ...row } : null, error: row ? null : { message: "missing" } });
      chain.update = (value: Record<string, unknown>) => { patch = value; return chain; };
      chain.maybeSingle = async () => {
        if (!row || !patch) return { data: null, error: null };
        const matches = Object.entries(filters).every(([key, value]) => {
          if (key.startsWith("in_")) return Array.isArray(value) && value.includes(row?.[key.slice(3)]);
          return row?.[key] === value;
        });
        if (!matches) return { data: null, error: null };
        Object.assign(row, patch);
        return { data: { id: row.id }, error: null };
      };
      chain.then = (resolve: (value: { data: null; error: null }) => unknown) => {
        if (row && patch) {
          const matches = Object.entries(filters).every(([key, value]) => row?.[key] === value);
          if (matches) Object.assign(row, patch);
        }
        return resolve({ data: null, error: null });
      };
      return chain;
    },
  } as never;
  return { sb, get row() { return row; } };
}

describe("agent outbound outbox", () => {
  it("drops a reply when a newer conversation sequence already exists", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const sb = {
      rpc,
      from: () => {
        throw new Error("outbox must not be written for a stale sequence");
      },
    } as never;
    await expect(prepareAgentOutbound({
      sb,
      job: { ...job, conversation_sequence: 5 },
      generation: 1,
      content: "Resposta antiga",
    })).resolves.toEqual({ action: "stale", id: job.id });
    expect(rpc).toHaveBeenCalledWith("is_agent_conversation_sequence_current", {
      p_tenant_id: job.tenant_id,
      p_remote_jid: job.remote_jid,
      p_sequence: 5,
    });
  });

  it("persists and claims the reply intent before provider dispatch", async () => {
    const state = makeSb();
    const result = await prepareAgentOutbound({
      sb: state.sb,
      job,
      generation: 1,
      content: "Resposta consolidada",
    });

    expect(result.action).toBe("send");
    expect(state.row).toMatchObject({
      job_id: job.id,
      burst_generation: 1,
      status: "processing",
      content: "Resposta consolidada",
      attempts: 1,
    });
  });

  it("never sends again when the same generation is already accepted", async () => {
    const state = makeSb({
      id: "outbound-1",
      status: "sent",
      attempts: 1,
      claim_token: null,
      claim_expires_at: null,
      provider_message_id: "provider-1",
    });
    await expect(prepareAgentOutbound({
      sb: state.sb,
      job,
      generation: 1,
      content: "Resposta consolidada",
    })).resolves.toEqual({ action: "already_sent", id: "outbound-1" });
  });

  it("marks an interrupted dispatch ambiguous instead of resending blindly", async () => {
    const state = makeSb({
      id: "outbound-1",
      status: "processing",
      attempts: 1,
      claim_token: "old-claim",
      claim_expires_at: "2026-07-16T10:03:00.000Z",
      provider_message_id: null,
    });
    await expect(prepareAgentOutbound({
      sb: state.sb,
      job,
      generation: 1,
      content: "Resposta consolidada",
    })).resolves.toEqual({ action: "ambiguous", id: "outbound-1" });
    expect(state.row).toMatchObject({ status: "ambiguous", last_error: "dispatch_ambiguous" });
  });

  it("finalizes success and releases a retryable failure only with the claim token", async () => {
    const success = makeSb({
      id: "outbound-1",
      status: "processing",
      attempts: 1,
      claim_token: "claim-1",
    });
    await markAgentOutboundSent({
      sb: success.sb,
      id: "outbound-1",
      claimToken: "claim-1",
      providerMessageId: "provider-1",
    });
    expect(success.row).toMatchObject({ status: "sent", provider_message_id: "provider-1", claim_token: null });

    const failed = makeSb({
      id: "outbound-2",
      status: "processing",
      attempts: 1,
      claim_token: "claim-2",
    });
    await markAgentOutboundFailed({
      sb: failed.sb,
      id: "outbound-2",
      claimToken: "claim-2",
      error: "network_error",
    });
    expect(failed.row).toMatchObject({ status: "failed", last_error: "network_error", claim_token: null });
  });
});
