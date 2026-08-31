import { describe, expect, it, vi } from "vitest";
import {
  authorizeAutomatedOutbound,
  finalizeAgentOutboundDelivery,
  markAgentOutboundFailed,
  markAgentOutboundSent,
  prepareAutomatedOutbound,
  prepareAgentOutbound,
  reconcileAgentOutboundEcho,
} from "@/lib/server/agent-outbound-outbox";
import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";

const job: AgentResponseJobRow = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  tenant_id: "tenant-1",
  lead_id: null,
  journey_id: null,
  rule_id: "rule-1",
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

function makeSb(
  initial?: Record<string, unknown>,
  authorization: { ok: boolean; reason: string } = {
    ok: true,
    reason: "allowed",
  },
) {
  let row: Record<string, unknown> | null = initial ? { ...initial } : null;
  const sb = {
    from: (table: string) => {
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
        if (table === "conversation_states") {
          return {
            data: { automation_epoch: 1, conversation_mode: "automation", human_paused: false },
            error: null,
          };
        }
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
    rpc: async (name: string) =>
      name === "authorize_agent_outbound_dispatch_v3"
        ? { data: authorization, error: null }
        : { data: true, error: null },
  } as never;
  return { sb, get row() { return row; } };
}

describe("agent outbound outbox", () => {
  describe("transactional dispatch authorization", () => {
    function authorizationSb(options: {
      state?: unknown;
      stateError?: unknown;
      decision?: unknown;
      rpcError?: unknown;
    }) {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: options.state ?? { automation_epoch: 7, conversation_mode: "automation", human_paused: false },
        error: options.stateError ?? null,
      });
      const chain: Record<string, unknown> = {};
      const select = vi.fn(() => chain);
      const eq = vi.fn(() => chain);
      chain.select = select;
      chain.eq = eq;
      chain.maybeSingle = maybeSingle;
      const rpc = vi.fn().mockResolvedValue({
        data: Object.prototype.hasOwnProperty.call(options, "decision")
          ? options.decision
          : { ok: true, reason: "allowed" },
        error: options.rpcError ?? null,
      });
      const from = vi.fn(() => chain);
      return { sb: { from, rpc } as never, rpc, from, select, eq };
    }

    it("passes the exact current epoch to the atomic RPC", async () => {
      const { sb, rpc, from, select, eq } = authorizationSb({});
      await expect(authorizeAutomatedOutbound({
        sb, outboxId: "outbox-1", claimToken: "claim-1", tenantId: "tenant-1", remoteJid: "remote-1",
      })).resolves.toEqual({ ok: true, automationEpoch: 7 });
      expect(rpc).toHaveBeenCalledWith("authorize_agent_outbound_dispatch_v3", {
        p_outbox_id: "outbox-1",
        p_claim_token: "claim-1",
        p_expected_epoch: 7,
      });
      expect(from).toHaveBeenCalledWith("conversation_states");
      expect(select).toHaveBeenCalledWith("automation_epoch,conversation_mode,human_paused");
      expect(eq.mock.calls).toEqual([
        ["tenant_id", "tenant-1"],
        ["remote_jid", "remote-1"],
        ["channel", "whatsapp"],
      ]);
    });

    it("fails closed before the RPC when conversation state cannot be read", async () => {
      const { sb, rpc } = authorizationSb({ stateError: { message: "state_unavailable" } });
      await expect(authorizeAutomatedOutbound({
        sb, outboxId: "outbox-1", claimToken: "claim-1", tenantId: "tenant-1", remoteJid: "remote-1",
      })).resolves.toEqual({ ok: false, reason: "state_unavailable" });
      expect(rpc).not.toHaveBeenCalled();
    });

    it.each([
      [{ ok: false, reason: "human_active" }, null, "human_active"],
      [{ ok: false }, null, "authorization_blocked"],
      [null, null, "authorization_rpc_failed"],
      ["invalid", null, "authorization_rpc_failed"],
      [{ ok: true }, { message: "rpc_offline" }, "rpc_offline"],
    ] as const)("blocks malformed or denied decisions", async (decision, rpcError, reason) => {
      const { sb } = authorizationSb({ decision, rpcError });
      await expect(authorizeAutomatedOutbound({
        sb, outboxId: "outbox-1", claimToken: "claim-1", tenantId: "tenant-1", remoteJid: "remote-1",
      })).resolves.toEqual({ ok: false, reason });
    });

    it("normalizes a missing or invalid epoch to zero for fail-closed database validation", async () => {
      const { sb, rpc } = authorizationSb({ state: { automation_epoch: "invalid" } });
      await authorizeAutomatedOutbound({
        sb, outboxId: "outbox-1", claimToken: "claim-1", tenantId: "tenant-1", remoteJid: "remote-1",
      });
      expect(rpc).toHaveBeenCalledWith("authorize_agent_outbound_dispatch_v3", expect.objectContaining({
        p_expected_epoch: 0,
      }));
    });
  });

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

  describe("identidade de regra obrigatória", () => {
    it("bloqueia job sem rule_id independentemente de flag", async () => {
      process.env.AGENT_RULE_IDENTITY_V5_ENABLED = "false";
      const state = makeSb();
      const result = await prepareAgentOutbound({
        sb: state.sb,
        job: { ...job, rule_id: null },
        generation: 1,
        content: "Resposta consolidada",
      });
      expect(result).toEqual({ action: "blocked", id: job.id, reason: "rule_missing" });
    });

    it("bloqueia disparo automático sem regra exata", async () => {
      const state = makeSb();
      const result = await prepareAutomatedOutbound({
        sb: state.sb,
        operationKey: "follow-up:legado:1",
        tenantId: "tenant-1",
        remoteJid: job.remote_jid,
        agentId: "agent-1",
        journeyId: null,
        ruleId: null,
        connectionId: "connection-1",
        channel: "evolution",
        kind: "text",
        content: "Follow-up legado",
      });
      expect(result).toEqual({
        action: "blocked",
        id: "follow-up:legado:1",
        reason: "rule_missing",
      });
    });
  });

  it.each([
    "Atenda conforme as instruções livres do cliente.",
    "Follow the customer's arbitrary instructions.",
    "Sigue las instrucciones personalizadas del cliente.",
    "Répondez selon les instructions configurées.",
  ])("preserva conteúdo e idioma sem especialização: %s", async (content) => {
    const state = makeSb();
    const result = await prepareAgentOutbound({
      sb: state.sb,
      job,
      generation: 1,
      content,
    });

    expect(result.action).toBe("send");
    expect(state.row?.content).toBe(content);
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

  it("does not steal an outbox claim that is still active", async () => {
    const state = makeSb({
      id: "outbound-1",
      status: "processing",
      attempts: 1,
      claim_token: "active-claim",
      claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
      provider_message_id: null,
    });

    await expect(prepareAgentOutbound({
      sb: state.sb,
      job,
      generation: 1,
      content: "Resposta consolidada",
    })).resolves.toEqual({ action: "in_progress", id: "outbound-1" });
    expect(state.row).toMatchObject({ status: "processing", claim_token: "active-claim" });
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

  it("atomically finalizes provider receipt, audited bubble and conversation sequence", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        reason: "sent",
        outboxId: "outbound-1",
        messageId: "message-row-1",
        providerMessageId: "provider-1",
      },
      error: null,
    });
    await expect(finalizeAgentOutboundDelivery({
      sb: { rpc } as never,
      id: "outbound-1",
      claimToken: "claim-1",
      providerMessageId: "provider-1",
      kind: "text",
      content: "One logical reply",
      providerRemoteJid: "5511999999999@s.whatsapp.net",
      providerStatus: "SERVER_ACK",
      deliveryStatus: "sent",
    })).resolves.toEqual({
      outboxId: "outbound-1",
      messageId: "message-row-1",
      providerMessageId: "provider-1",
    });
    expect(rpc).toHaveBeenCalledWith("finalize_agent_outbound_delivery_v1", {
      p_outbox_id: "outbound-1",
      p_claim_token: "claim-1",
      p_provider_message_id: "provider-1",
      p_kind: "text",
      p_content: "One logical reply",
      p_provider_remote_jid: "5511999999999@s.whatsapp.net",
      p_provider_status: "SERVER_ACK",
      p_delivery_status: "sent",
      p_media_url: null,
    });
  });

  it("reconciles an early Evolution echo before it can trigger human takeover", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, matched: true, reason: "automatic_echo_reconciled" },
      error: null,
    });
    await expect(reconcileAgentOutboundEcho({
      sb: { rpc } as never,
      tenantId: "tenant-1",
      connectionId: "connection-1",
      remoteJid: job.remote_jid,
      providerMessageId: "provider-echo-1",
      kind: "text",
      content: "One logical reply",
      providerRemoteJid: job.remote_jid,
    })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("reconcile_agent_outbound_echo_v1", {
      p_tenant_id: "tenant-1",
      p_connection_id: "connection-1",
      p_remote_jid: job.remote_jid,
      p_provider_message_id: "provider-echo-1",
      p_kind: "text",
      p_content: "One logical reply",
      p_provider_remote_jid: job.remote_jid,
      p_provider_status: "SERVER_ACK",
      p_delivery_status: "sent",
    });
  });

  it("atomically cancels an automated outbox row when authorization denies dispatch", async () => {
    const state = makeSb(undefined, {
      ok: false,
      reason: "human_attending",
    });

    await expect(
      prepareAutomatedOutbound({
        sb: state.sb,
        operationKey: "meta-leadgen:lead-1:initial",
        tenantId: "tenant-1",
        remoteJid: "5511999999999@s.whatsapp.net",
        agentId: "agent-1",
        journeyId: "423e4567-e89b-42d3-a456-426614174000",
        ruleId: "rule-1",
        connectionId: "connection-1",
        channel: "evolution",
        kind: "text",
        content: "Mensagem",
      }),
    ).resolves.toEqual({
      action: "blocked",
      id: "outbound-1",
      reason: "human_attending",
    });
    expect(state.row).toMatchObject({
      status: "cancelled",
      authorization_status: "blocked",
      authorization_reason: "human_attending",
      claim_token: null,
    });
  });
});
