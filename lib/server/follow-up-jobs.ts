import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import type { AgentFollowUpInteligente } from "@/lib/types";
import { phoneFromRemoteJid } from "@/lib/server/auto-lead-upsert";
import { isAgentAutomationAllowed } from "@/lib/server/conversation-operation";
import {
  conversationMessagesToAi,
  getRecentConversationMessages,
} from "@/lib/server/conversation-memory";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type FollowUpJobRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  remote_jid: string;
  scheduled_at: string;
  attempts: number;
  max_attempts: number;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const FOLLOW_UP_USER_INSTRUCTION =
  "O cliente não respondeu há algum tempo. Envie uma mensagem de follow-up natural e contextual para retomar a conversa, sem ser insistente.";

function logFollowUp(event: string, payload: Record<string, unknown>): void {
  console.info("[follow-up-jobs]", { event, ...payload });
}

function rowFromDb(data: Record<string, unknown>): FollowUpJobRow {
  return {
    id: String(data.id),
    tenant_id: String(data.tenant_id),
    agent_id: String(data.agent_id),
    remote_jid: String(data.remote_jid),
    scheduled_at: String(data.scheduled_at),
    attempts: Number(data.attempts ?? 0),
    max_attempts: Number(data.max_attempts ?? 3),
    status: String(data.status),
    last_error: typeof data.last_error === "string" ? data.last_error : null,
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
  };
}

export async function cancelPendingFollowUpJobs(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  reason?: string;
}): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await params.sb
    .from("follow_up_jobs")
    .update({
      status: "cancelled",
      last_error: params.reason ?? "cancelled",
      updated_at: now,
    })
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("status", "pending")
    .select("id");
  if (error) {
    logFollowUp("cancel_failed", { tenant_id: params.tenantId, error: error.message });
    return 0;
  }
  const count = Array.isArray(data) ? data.length : 0;
  if (count > 0) logFollowUp("cancelled_pending", { tenant_id: params.tenantId, count });
  return count;
}

export async function scheduleFollowUpAfterInbound(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  leadId?: string | null;
  settings: AgentFollowUpInteligente;
}): Promise<string | null> {
  if (!params.settings.ativo) return null;

  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date();
  const scheduledAt = new Date(
    now.getTime() + params.settings.intervaloVerificacaoMinutos * 60_000,
  );

  await cancelPendingFollowUpJobs({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: "inbound_reset",
  });

  const { data, error } = await sb
    .from("follow_up_jobs")
    .insert({
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      remote_jid: params.remoteJid,
      scheduled_at: scheduledAt.toISOString(),
      max_attempts: params.settings.tentativasContato,
      attempts: 0,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    logFollowUp("schedule_failed", {
      tenant_id: params.tenantId,
      remote_jid: params.remoteJid,
      error: error?.message ?? "insert_failed",
    });
    return null;
  }

  if (params.leadId) {
    await sb
      .from("leads")
      .update({
        follow_up_scheduled_at: scheduledAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", params.leadId)
      .eq("tenant_id", params.tenantId);
  }

  logFollowUp("scheduled", {
    tenant_id: params.tenantId,
    job_id: (data as { id: string }).id,
    scheduled_at: scheduledAt.toISOString(),
    max_attempts: params.settings.tentativasContato,
  });

  return String((data as { id: string }).id);
}

async function saveOutboundFollowUp(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentId: string;
  content: string;
  leadId?: string | null;
}): Promise<void> {
  await params.sb.from("whatsapp_messages").insert({
    tenant_id: params.tenantId,
    remote_jid: params.remoteJid,
    direction: "outbound",
    kind: "text",
    content: params.content.slice(0, 4000),
    agent_id: params.agentId,
    lead_id: params.leadId ?? null,
  });
}

async function loadLeadForFollowUp(
  sb: SupabaseServiceClient,
  tenantId: string,
  remoteJid: string,
): Promise<{ id: string; last_message_at: string | null; follow_up_count: number } | null> {
  const phone = phoneFromRemoteJid(remoteJid);
  if (!phone) return null;
  const { data } = await sb
    .from("leads")
    .select("id, last_message_at, follow_up_count")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; last_message_at?: string | null; follow_up_count?: number };
  return {
    id: row.id,
    last_message_at: row.last_message_at ?? null,
    follow_up_count: Number(row.follow_up_count ?? 0),
  };
}

export async function processFollowUpJob(
  jobId: string,
  sb?: SupabaseServiceClient,
): Promise<"sent" | "cancelled" | "exhausted" | "skipped" | "failed"> {
  const client = sb ?? createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: claimed, error: claimError } = await client
    .from("follow_up_jobs")
    .update({ status: "processing", updated_at: nowIso })
    .eq("id", jobId)
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .select("*")
    .maybeSingle();

  if (claimError) {
    logFollowUp("claim_failed", { job_id: jobId, error: claimError.message });
    return "failed";
  }
  if (!claimed) return "skipped";

  const job = rowFromDb(claimed as Record<string, unknown>);
  logFollowUp("processing", { job_id: job.id, tenant_id: job.tenant_id, attempts: job.attempts });

  try {
    const lead = await loadLeadForFollowUp(client, job.tenant_id, job.remote_jid);
    if (lead?.last_message_at && new Date(lead.last_message_at).getTime() > new Date(job.created_at).getTime()) {
      await client
        .from("follow_up_jobs")
        .update({ status: "cancelled", last_error: "customer_replied", updated_at: nowIso })
        .eq("id", job.id);
      logFollowUp("cancelled_customer_replied", { job_id: job.id });
      return "cancelled";
    }

    const automationAllowed = await isAgentAutomationAllowed({
      sb: client,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      agentId: job.agent_id,
    });
    if (!automationAllowed.ok) {
      await client
        .from("follow_up_jobs")
        .update({ status: "cancelled", last_error: automationAllowed.reason, updated_at: nowIso })
        .eq("id", job.id);
      logFollowUp("cancelled_automation", { job_id: job.id, reason: automationAllowed.reason });
      return "cancelled";
    }

    const { data: agentRow } = await client
      .from("tenant_agents")
      .select("metadata")
      .eq("tenant_id", job.tenant_id)
      .eq("agent_id", job.agent_id)
      .maybeSingle();
    const metadata =
      agentRow?.metadata && typeof agentRow.metadata === "object"
        ? (agentRow.metadata as Record<string, unknown>)
        : {};
    const settings = followUpInteligenteFromMetadata(metadata);
    if (!settings.ativo) {
      await client
        .from("follow_up_jobs")
        .update({ status: "cancelled", last_error: "follow_up_disabled", updated_at: nowIso })
        .eq("id", job.id);
      return "cancelled";
    }

    const history = await getRecentConversationMessages({
      sb: client,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      limit: 20,
    });

    const result = await generateAgentResponse({
      tenantId: job.tenant_id,
      agentId: job.agent_id,
      conversationId: job.remote_jid,
      customerId: job.remote_jid,
      feature: "agent_chat",
      messages: [
        ...conversationMessagesToAi(history),
        { role: "user", content: FOLLOW_UP_USER_INSTRUCTION },
      ],
    });

    const replyText = result.ok
      ? result.text
      : "Oi! Passando para saber se ainda posso te ajudar com algo. Fico à disposição.";

    const instance = await getEvolutionInstanceByTenantId(job.tenant_id);
    if (!instance?.instance_name) {
      await client
        .from("follow_up_jobs")
        .update({ status: "cancelled", last_error: "missing_evolution_instance", updated_at: nowIso })
        .eq("id", job.id);
      return "failed";
    }

    const number = remoteJidToEvoNumber(job.remote_jid);
    if (!number) {
      await client
        .from("follow_up_jobs")
        .update({ status: "cancelled", last_error: "invalid_remote_jid", updated_at: nowIso })
        .eq("id", job.id);
      return "failed";
    }

    const send = await evolutionSendText({
      instanceName: instance.instance_name,
      number,
      text: replyText.slice(0, 4000),
    });

    if (!send.ok) {
      await client
        .from("follow_up_jobs")
        .update({ status: "pending", last_error: send.error, updated_at: nowIso })
        .eq("id", job.id);
      logFollowUp("send_failed", { job_id: job.id, error: send.error });
      return "failed";
    }

    await saveOutboundFollowUp({
      sb: client,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      agentId: job.agent_id,
      content: replyText,
      leadId: lead?.id ?? null,
    });

    const nextAttempts = job.attempts + 1;
    const now = new Date();

    if (lead?.id) {
      await client
        .from("leads")
        .update({
          follow_up_count: (lead.follow_up_count ?? 0) + 1,
          last_follow_up_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", lead.id);
    }

    if (nextAttempts >= job.max_attempts) {
      await client
        .from("follow_up_jobs")
        .update({
          status: "exhausted",
          attempts: nextAttempts,
          last_error: null,
          updated_at: now.toISOString(),
        })
        .eq("id", job.id);
      if (lead?.id) {
        await client
          .from("leads")
          .update({ follow_up_scheduled_at: null, updated_at: now.toISOString() })
          .eq("id", lead.id);
      }
      logFollowUp("exhausted", { job_id: job.id, attempts: nextAttempts });
      return "exhausted";
    }

    const nextScheduled = new Date(now.getTime() + settings.intervaloVerificacaoMinutos * 60_000);

    await client
      .from("follow_up_jobs")
      .update({
        status: "sent",
        attempts: nextAttempts,
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("id", job.id);

    const { error: rescheduleError } = await client.from("follow_up_jobs").insert({
      tenant_id: job.tenant_id,
      agent_id: job.agent_id,
      remote_jid: job.remote_jid,
      scheduled_at: nextScheduled.toISOString(),
      attempts: nextAttempts,
      max_attempts: job.max_attempts,
      status: "pending",
    });

    if (rescheduleError) {
      logFollowUp("reschedule_failed", { job_id: job.id, error: rescheduleError.message });
    } else if (lead?.id) {
      await client
        .from("leads")
        .update({
          follow_up_scheduled_at: nextScheduled.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", lead.id);
    }

    logFollowUp("sent", {
      job_id: job.id,
      attempts: nextAttempts,
      history_messages: history.length,
      next_scheduled_at: nextScheduled.toISOString(),
    });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    await client
      .from("follow_up_jobs")
      .update({ status: "pending", last_error: message, updated_at: nowIso })
      .eq("id", jobId);
    logFollowUp("process_error", { job_id: jobId, error: message });
    return "failed";
  }
}

export async function processDueFollowUpJobs(sb?: SupabaseServiceClient): Promise<{
  processed: number;
  sent: number;
  cancelled: number;
  exhausted: number;
  failed: number;
}> {
  const client = sb ?? createSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const { data } = await client
    .from("follow_up_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(30);

  let processed = 0;
  let sent = 0;
  let cancelled = 0;
  let exhausted = 0;
  let failed = 0;

  for (const row of data ?? []) {
    const outcome = await processFollowUpJob(String((row as { id: string }).id), client);
    if (outcome === "skipped") continue;
    processed += 1;
    if (outcome === "sent") sent += 1;
    if (outcome === "cancelled") cancelled += 1;
    if (outcome === "exhausted") exhausted += 1;
    if (outcome === "failed") failed += 1;
  }

  return { processed, sent, cancelled, exhausted, failed };
}
