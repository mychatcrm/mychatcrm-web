import "server-only";

import { markWaitingForHuman } from "@/lib/server/conversation-operation";
import {
  cancelAgendaRemindersForEvent,
  scheduleAgendaRemindersForEvent,
} from "@/lib/server/agenda-reminder-jobs";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AgentAgendaLembretes } from "@/lib/types";
import type { ProcessAgendaDirectivesResult } from "@/lib/server/agent-cta-scheduler";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type AgendaMutationAction = Extract<
  ProcessAgendaDirectivesResult["action"],
  "scheduled" | "rescheduled" | "cancelled"
>;

export async function unblockFollowUpForContact(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
}): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await params.sb
      .from("follow_up_jobs")
      .update({ scheduled_at: now, updated_at: now })
      .eq("tenant_id", params.tenantId)
      .eq("remote_jid", params.remoteJid)
      .eq("status", "pending");

    if (error) {
      console.warn("[agenda-post-success] followup_unblock_failed", {
        tenant_id: params.tenantId,
        error: error.message,
      });
      return;
    }

    const baseUrl =
      process.env.MYCHATCRM_PUBLIC_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      "";
    const internalToken = process.env.INTERNAL_API_TOKEN?.trim();
    if (baseUrl && internalToken) {
      void fetch(`${baseUrl}/api/internal/process-follow-ups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": internalToken,
        },
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    }
  } catch (err) {
    console.warn("[agenda-post-success] unblock_followup_exception", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function cancelPendingSilenceFollowUpJobs(params: {
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
      last_error: params.reason ?? "agenda_confirmed",
      updated_at: now,
    })
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("status", "pending")
    .eq("follow_up_type", "silence")
    .select("id");

  if (error) {
    console.warn("[agenda-post-success] cancel_silence_followup_failed", {
      tenant_id: params.tenantId,
      error: error.message,
    });
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

export type AgendaPostSuccessParams = {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId: string | null;
  agentId: string;
  action: AgendaMutationAction;
  eventId?: string;
  timezone: string;
  ctaHandoffAtivo: boolean;
  handoffNumero: string | null;
  agendaLembretes: AgentAgendaLembretes | null | undefined;
  lastMessage?: string | null;
  handoffAlreadyTriggered?: boolean;
  previousEventId?: string | null;
};

export type AgendaPostSuccessResult = {
  scheduleHandoffTriggered: boolean;
};

export async function applyAgendaPostSuccessEffects(
  params: AgendaPostSuccessParams,
): Promise<AgendaPostSuccessResult> {
  const sb = params.sb ?? createSupabaseServiceClient();
  let scheduleHandoffTriggered = false;

  if (params.action === "cancelled") {
    if (params.eventId) {
      await cancelAgendaRemindersForEvent({
        sb,
        tenantId: params.tenantId,
        agendaEventId: params.eventId,
      });
    }
    await unblockFollowUpForContact({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
    });
    return { scheduleHandoffTriggered: false };
  }

  if (params.action === "scheduled" || params.action === "rescheduled") {
    if (params.eventId) {
      await scheduleAgendaRemindersForEvent({
        sb,
        tenantId: params.tenantId,
        agentId: params.agentId,
        remoteJid: params.remoteJid,
        leadId: params.leadId,
        agendaEventId: params.eventId,
        agendaLembretes: params.agendaLembretes,
        timezone: params.timezone,
        cancelPreviousEventId: params.action === "rescheduled" ? params.previousEventId : null,
      });
    }

    if (params.ctaHandoffAtivo === true && !params.handoffAlreadyTriggered) {
      await markWaitingForHuman({
        sb,
        tenantId: params.tenantId,
        remoteJid: params.remoteJid,
        leadId: params.leadId,
        agentId: params.agentId,
        reason: "schedule_confirmed",
        handoffNumero: params.handoffNumero,
        lastMessage: params.lastMessage ?? null,
      });
      scheduleHandoffTriggered = true;
    } else if (params.ctaHandoffAtivo !== true) {
      await cancelPendingSilenceFollowUpJobs({
        sb,
        tenantId: params.tenantId,
        remoteJid: params.remoteJid,
        reason: "agenda_confirmed",
      });
    }
  }

  console.info("[agenda-post-success]", {
    tenant_id: params.tenantId,
    agent_id: params.agentId,
    action: params.action,
    event_id: params.eventId,
    schedule_handoff: scheduleHandoffTriggered,
  });

  return { scheduleHandoffTriggered };
}

export function agendaLembretesFromMetadata(
  metadata: Record<string, unknown>,
): AgentAgendaLembretes | null {
  const raw = metadata.agendaLembretes;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const regras = Array.isArray(obj.regras)
    ? obj.regras
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .slice(0, 3)
        .map((item) => ({
          offsetValor: Math.max(1, Number(item.offsetValor) || 1),
          offsetUnidade: (item.offsetUnidade === "dias" ||
          item.offsetUnidade === "horas" ||
          item.offsetUnidade === "minutos"
            ? item.offsetUnidade
            : "horas") as "minutos" | "horas" | "dias",
          mensagem: typeof item.mensagem === "string" ? item.mensagem : undefined,
        }))
    : [];
  return {
    ativo: obj.ativo === true,
    regras,
  };
}

export function buildAgendaPostSuccessParams(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId: string | null;
  agentId: string;
  timezone: string;
  metadata: Record<string, unknown>;
  action: AgendaMutationAction;
  eventId?: string;
  lastMessage?: string | null;
  handoffAlreadyTriggered?: boolean;
  previousEventId?: string | null;
}): AgendaPostSuccessParams {
  return {
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    action: params.action,
    eventId: params.eventId,
    timezone: params.timezone,
    ctaHandoffAtivo: params.metadata.ctaHandoffAtivo === true,
    handoffNumero:
      typeof params.metadata.handoffNumero === "string" ? params.metadata.handoffNumero : null,
    agendaLembretes: agendaLembretesFromMetadata(params.metadata),
    lastMessage: params.lastMessage,
    handoffAlreadyTriggered: params.handoffAlreadyTriggered,
    previousEventId: params.previousEventId,
  };
}
