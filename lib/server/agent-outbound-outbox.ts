import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type OutboxRow = {
  id: string;
  status: string;
  attempts: number;
  claim_token: string | null;
  claim_expires_at: string | null;
  provider_message_id: string | null;
};

export type PreparedAgentOutbound =
  | { action: "send"; id: string; claimToken: string }
  | { action: "already_sent"; id: string }
  | { action: "ambiguous"; id: string }
  | { action: "stale"; id: string };

async function conversationSequenceIsCurrent(
  sb: SupabaseServiceClient,
  job: AgentResponseJobRow,
): Promise<boolean> {
  const sequence = Number(job.conversation_sequence ?? 0);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return true;
  const { data, error } = await sb.rpc("is_agent_conversation_sequence_current", {
    p_tenant_id: job.tenant_id,
    p_remote_jid: job.remote_jid,
    p_sequence: sequence,
  });
  return !error && data === true;
}

/**
 * Persiste a intenção antes da chamada ao provedor. Um reclaim de envio que já
 * começou nunca reenvia às cegas: fica ambíguo para reconciliação, evitando
 * duas respostas ao mesmo burst.
 */
export async function prepareAgentOutbound(params: {
  sb: SupabaseServiceClient;
  job: AgentResponseJobRow;
  generation: number;
  kind?: "text" | "audio";
  content: string;
}): Promise<PreparedAgentOutbound> {
  const kind = params.kind ?? "text";
  if (!(await conversationSequenceIsCurrent(params.sb, params.job))) {
    return { action: "stale", id: params.job.id };
  }
  const { error: upsertError } = await params.sb.from("agent_outbound_outbox").upsert(
    {
      tenant_id: params.job.tenant_id,
      job_id: params.job.id,
      burst_generation: params.generation,
      conversation_sequence: Number(params.job.conversation_sequence ?? 0),
      channel: params.job.channel,
      connection_id: params.job.connection_id,
      remote_jid: params.job.remote_jid,
      agent_id: params.job.agent_id,
      lead_id: params.job.lead_id,
      journey_id: params.job.journey_id,
      kind,
      content: params.content,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "job_id,burst_generation,kind", ignoreDuplicates: true },
  );
  if (upsertError) throw new Error(upsertError.message);

  const { data, error } = await params.sb
    .from("agent_outbound_outbox")
    .select("id,status,attempts,claim_token,claim_expires_at,provider_message_id")
    .eq("job_id", params.job.id)
    .eq("burst_generation", params.generation)
    .eq("kind", kind)
    .single();
  if (error || !data) throw new Error(error?.message ?? "outbound_intent_missing");
  const row = data as OutboxRow;
  if (row.status === "sent" || row.status === "delivered") {
    return { action: "already_sent", id: row.id };
  }
  if (row.status === "processing" || row.status === "ambiguous") {
    if (row.status === "processing" && row.provider_message_id) {
      return { action: "already_sent", id: row.id };
    }
    await params.sb
      .from("agent_outbound_outbox")
      .update({
        status: "ambiguous",
        claim_token: null,
        claim_expires_at: null,
        last_error: "dispatch_ambiguous",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "processing");
    return { action: "ambiguous", id: row.id };
  }

  const claimToken = crypto.randomUUID();
  const now = new Date().toISOString();
  const { data: claimed } = await params.sb
    .from("agent_outbound_outbox")
    .update({
      status: "processing",
      attempts: row.attempts + 1,
      claim_token: claimToken,
      claim_expires_at: new Date(Date.now() + 180_000).toISOString(),
      last_error: "dispatch_started",
      updated_at: now,
    })
    .eq("id", row.id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (!claimed) return { action: "ambiguous", id: row.id };
  if (!(await conversationSequenceIsCurrent(params.sb, params.job))) {
    await params.sb
      .from("agent_outbound_outbox")
      .update({
        status: "cancelled",
        claim_token: null,
        claim_expires_at: null,
        last_error: "conversation_sequence_superseded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("claim_token", claimToken);
    return { action: "stale", id: row.id };
  }
  return { action: "send", id: row.id, claimToken };
}

export async function markAgentOutboundSent(params: {
  sb: SupabaseServiceClient;
  id: string;
  claimToken: string;
  providerMessageId?: string | null;
  job?: AgentResponseJobRow;
}): Promise<void> {
  const { error } = await params.sb
    .from("agent_outbound_outbox")
    .update({
      status: "sent",
      provider_message_id: params.providerMessageId ?? null,
      sent_at: new Date().toISOString(),
      claim_token: null,
      claim_expires_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("status", "processing")
    .eq("claim_token", params.claimToken);
  if (error) throw new Error(error.message);
  if (params.job && Number(params.job.conversation_sequence ?? 0) > 0) {
    const { error: stateError } = await params.sb.rpc("mark_agent_conversation_response", {
      p_tenant_id: params.job.tenant_id,
      p_remote_jid: params.job.remote_jid,
      p_sequence: Number(params.job.conversation_sequence),
      p_responded_at: new Date().toISOString(),
    });
    if (stateError) {
      console.warn("[agent-outbound-outbox] response_sequence_mark_failed", {
        job_id: params.job.id,
        error: stateError.message,
      });
    }
  }
}

export async function markAgentOutboundFailed(params: {
  sb: SupabaseServiceClient;
  id: string;
  claimToken: string;
  error: string;
}): Promise<void> {
  await params.sb
    .from("agent_outbound_outbox")
    .update({
      status: "failed",
      claim_token: null,
      claim_expires_at: null,
      last_error: params.error.slice(0, 500),
      next_attempt_at: new Date(Date.now() + 5_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("status", "processing")
    .eq("claim_token", params.claimToken);
}
