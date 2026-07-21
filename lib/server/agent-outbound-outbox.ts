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

type ConversationAuthorizationRow = {
  automation_epoch: number;
  conversation_mode: string | null;
  human_paused: boolean;
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
 * Barreira central obrigatória para qualquer despacho automático.
 * A decisão final acontece dentro do Postgres, sob o mesmo advisory lock usado
 * pelo takeover humano. Falhas de leitura/RPC são sempre tratadas como bloqueio.
 */
export async function authorizeAutomatedOutbound(params: {
  sb: SupabaseServiceClient;
  outboxId: string;
  claimToken: string;
  tenantId: string;
  remoteJid: string;
}): Promise<{ ok: true; automationEpoch: number } | { ok: false; reason: string }> {
  const { data: state, error: stateError } = await params.sb
    .from("conversation_states")
    .select("automation_epoch,conversation_mode,human_paused")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (stateError) {
    return { ok: false, reason: stateError?.message ?? "conversation_state_missing" };
  }
  const current = (state ?? {}) as Partial<ConversationAuthorizationRow>;
  const epoch = Number.isSafeInteger(Number(current.automation_epoch))
    ? Number(current.automation_epoch)
    : 0;
  const { data, error } = await params.sb.rpc("authorize_agent_outbound_dispatch_v2", {
    p_outbox_id: params.outboxId,
    p_claim_token: params.claimToken,
    p_expected_epoch: epoch,
  });
  if (error || !data || typeof data !== "object") {
    return { ok: false, reason: error?.message ?? "authorization_rpc_failed" };
  }
  const decision = data as { ok?: unknown; reason?: unknown };
  return decision.ok === true
    ? { ok: true, automationEpoch: epoch }
    : { ok: false, reason: typeof decision.reason === "string" ? decision.reason : "authorization_blocked" };
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
  const { data: state, error: stateError } = await params.sb
    .from("conversation_states")
    .select("automation_epoch")
    .eq("tenant_id", params.job.tenant_id)
    .eq("remote_jid", params.job.remote_jid)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (stateError || !state || !Number.isSafeInteger(Number(state.automation_epoch))) {
    return { action: "stale", id: params.job.id };
  }
  const automationEpoch = Number(state.automation_epoch);
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
      operation_key: `agent-response:${params.job.id}:${params.generation}:${kind}`,
      automation_epoch: automationEpoch,
      authorization_status: "pending",
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
  const authorization = await authorizeAutomatedOutbound({
    sb: params.sb,
    outboxId: row.id,
    claimToken,
    tenantId: params.job.tenant_id,
    remoteJid: params.job.remote_jid,
  });
  if (!authorization.ok) {
    await params.sb
      .from("agent_outbound_outbox")
      .update({
        status: "cancelled",
        authorization_status: "blocked",
        authorization_reason: authorization.reason,
        claim_token: null,
        claim_expires_at: null,
        last_error: authorization.reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("claim_token", claimToken);
    return { action: "stale", id: row.id };
  }
  return { action: "send", id: row.id, claimToken };
}

export async function prepareAutomatedOutbound(params: {
  sb: SupabaseServiceClient;
  operationKey: string;
  tenantId: string;
  remoteJid: string;
  agentId: string;
  journeyId: string;
  connectionId: string;
  channel: "evolution" | "meta_cloud";
  kind: "text" | "audio" | "image" | "video" | "document" | "template";
  content: string;
  leadId?: string | null;
}): Promise<PreparedAgentOutbound> {
  const { data: state, error: stateError } = await params.sb
    .from("conversation_states")
    .select("automation_epoch")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (stateError || !state || !Number.isSafeInteger(Number(state.automation_epoch))) {
    return { action: "stale", id: params.operationKey };
  }
  const now = new Date().toISOString();
  const { error: insertError } = await params.sb.from("agent_outbound_outbox").upsert(
    {
      tenant_id: params.tenantId,
      operation_key: params.operationKey,
      burst_generation: 0,
      conversation_sequence: 0,
      channel: params.channel,
      connection_id: params.connectionId,
      remote_jid: params.remoteJid,
      agent_id: params.agentId,
      lead_id: params.leadId ?? null,
      journey_id: params.journeyId,
      kind: params.kind,
      content: params.content,
      automation_epoch: Number(state.automation_epoch),
      authorization_status: "pending",
      status: "pending",
      next_attempt_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id,operation_key", ignoreDuplicates: true },
  );
  if (insertError) throw new Error(insertError.message);
  const { data, error } = await params.sb
    .from("agent_outbound_outbox")
    .select("id,status,attempts,claim_token,claim_expires_at,provider_message_id")
    .eq("tenant_id", params.tenantId)
    .eq("operation_key", params.operationKey)
    .single();
  if (error || !data) throw new Error(error?.message ?? "outbound_intent_missing");
  const row = data as OutboxRow;
  if (row.status === "sent" || row.status === "delivered") {
    return { action: "already_sent", id: row.id };
  }
  if (row.status === "processing" || row.status === "ambiguous") {
    return { action: "ambiguous", id: row.id };
  }
  const claimToken = crypto.randomUUID();
  const { data: claimed } = await params.sb
    .from("agent_outbound_outbox")
    .update({
      status: "processing",
      attempts: row.attempts + 1,
      claim_token: claimToken,
      claim_expires_at: new Date(Date.now() + 180_000).toISOString(),
      updated_at: now,
    })
    .eq("id", row.id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (!claimed) return { action: "ambiguous", id: row.id };
  const authorization = await authorizeAutomatedOutbound({
    sb: params.sb,
    outboxId: row.id,
    claimToken,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  return authorization.ok
    ? { action: "send", id: row.id, claimToken }
    : { action: "stale", id: row.id };
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
