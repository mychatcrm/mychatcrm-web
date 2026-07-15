import "server-only";

import {
  buildAppointmentOwnerNotificationText,
  type AppointmentNotificationAction,
} from "@/lib/server/agenda-owner-notifications";
import { getSystemAgentMetaConfig, sendSystemNotification } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const OUTBOX_TABLE = "agenda_notification_outbox";
const MAX_SEND_ATTEMPTS = 5;
export const META_TEMPLATE_REQUIRED_ERROR = "meta_template_required";

type OutboxRow = {
  id: string;
  tenant_id: string;
  agenda_event_id: string | null;
  action: AppointmentNotificationAction;
  operation_key: string;
  phone_last4: string | null;
  payload: { phone?: string; message?: string; agent_id?: string | null } | null;
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
};

function phoneLast4(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

/**
 * Enfileira o aviso ao dono APÓS uma mutação de agenda confirmada no banco.
 * Idempotente por (tenant_id, operation_key, action): retries de webhook/job e
 * replays dedupe da RPC nunca criam uma segunda notificação. Nunca lança — a
 * falha ao enfileirar não pode derrubar a mutação já commitada (fica no log).
 */
export async function enqueueAgendaOwnerNotification(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agendaEventId: string;
  action: AppointmentNotificationAction;
  operationKey: string;
  attendeeName: string | null;
  attendeePhone: string | null;
  startAtIso: string;
  location: string | null;
  timezone: string;
  agentId?: string | null;
}): Promise<{ enqueued: boolean; outboxId: string | null }> {
  try {
    const sb = params.sb ?? createSupabaseServiceClient();
    const { data: tenant, error: tenantError } = await sb
      .from("tenants")
      .select("appointment_notification_phone")
      .eq("id", params.tenantId)
      .maybeSingle();
    if (tenantError) {
      console.warn("[agenda-notification-outbox] tenant_lookup_failed", {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        error: tenantError.message,
      });
      return { enqueued: false, outboxId: null };
    }

    const phone = String(
      (tenant as { appointment_notification_phone?: string | null } | null)
        ?.appointment_notification_phone ?? "",
    ).trim();
    if (!phone) {
      console.info("[agenda-notification-outbox] skipped", {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        reason: "missing_appointment_notification_phone",
      });
      return { enqueued: false, outboxId: null };
    }

    const message = buildAppointmentOwnerNotificationText({
      action: params.action,
      attendeeName: params.attendeeName,
      attendeePhone: params.attendeePhone,
      startAtIso: params.startAtIso,
      timezone: params.timezone,
      location: params.location,
    });

    const { data, error } = await sb
      .from(OUTBOX_TABLE)
      .upsert(
        {
          tenant_id: params.tenantId,
          agenda_event_id: params.agendaEventId,
          action: params.action,
          operation_key: params.operationKey,
          phone_last4: phoneLast4(phone),
          payload: { phone, message, agent_id: params.agentId ?? null },
          status: "pending",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,operation_key,action", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    if (error) {
      console.warn("[agenda-notification-outbox] enqueue_failed", {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        action: params.action,
        error: error.message,
      });
      return { enqueued: false, outboxId: null };
    }

    if (!data?.id) {
      // Conflito na chave idempotente: notificação já registrada (retry/replay).
      console.info("[agenda-notification-outbox] deduplicated", {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        action: params.action,
      });
      return { enqueued: false, outboxId: null };
    }

    return { enqueued: true, outboxId: data.id as string };
  } catch (error) {
    console.warn("[agenda-notification-outbox] enqueue_failed", {
      tenant_id: params.tenantId,
      agenda_event_id: params.agendaEventId,
      action: params.action,
      error: error instanceof Error ? error.message : String(error),
    });
    return { enqueued: false, outboxId: null };
  }
}

async function markOutboxRow(
  sb: SupabaseServiceClient,
  row: OutboxRow,
  patch: { status?: OutboxRow["status"]; attempts?: number; last_error?: string | null },
): Promise<void> {
  const { error } = await sb
    .from(OUTBOX_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) {
    console.warn("[agenda-notification-outbox] mark_failed", {
      outbox_id: row.id,
      error: error.message,
    });
  }
}

async function sendOutboxRow(sb: SupabaseServiceClient, row: OutboxRow): Promise<"sent" | "failed" | "pending"> {
  const phone = row.payload?.phone?.trim();
  const message = row.payload?.message?.trim();
  if (!phone || !message) {
    await markOutboxRow(sb, row, { status: "failed", last_error: "invalid_outbox_payload" });
    return "failed";
  }

  // Gate operacional Meta: mensagem proativa fora da janela de 24h exige template
  // aprovado. Sem template, NÃO enviamos texto livre (a Meta aceita e descarta) e
  // NÃO marcamos como enviado — a linha fica pendente, com erro claro, reenviável
  // depois que o template for configurado em /admin/system-agent. O provider
  // ativo nunca é alterado por aqui.
  const metaConfig = await getSystemAgentMetaConfig().catch(() => null);
  if (metaConfig?.active && !metaConfig.templateName) {
    await markOutboxRow(sb, row, { last_error: META_TEMPLATE_REQUIRED_ERROR });
    console.warn("[agenda-notification-outbox] blocked", {
      outbox_id: row.id,
      tenant_id: row.tenant_id,
      action: row.action,
      reason: META_TEMPLATE_REQUIRED_ERROR,
      phone_last4: row.phone_last4,
    });
    return "pending";
  }

  const attempts = row.attempts + 1;
  const sent = await sendSystemNotification(phone, message, "", {
    type: "appointment_notification",
    metadata: {
      tenant_id: row.tenant_id,
      agenda_event_id: row.agenda_event_id,
      action: row.action,
      operation_key: row.operation_key,
      outbox_id: row.id,
      agent_id: row.payload?.agent_id ?? null,
      attendee_phone_last4: row.phone_last4,
    },
  }).catch((error) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (sent.ok) {
    await markOutboxRow(sb, row, { status: "sent", attempts, last_error: null });
    return "sent";
  }

  const exhausted = attempts >= MAX_SEND_ATTEMPTS;
  await markOutboxRow(sb, row, {
    status: exhausted ? "failed" : "pending",
    attempts,
    last_error: sent.error ?? "send_failed",
  });
  console.warn("[agenda-notification-outbox] send_failed", {
    outbox_id: row.id,
    tenant_id: row.tenant_id,
    action: row.action,
    attempts,
    exhausted,
    error: sent.error ?? "send_failed",
    phone_last4: row.phone_last4,
  });
  return exhausted ? "failed" : "pending";
}

/**
 * Processa linhas pendentes do outbox (envio inline pós-mutação via `outboxId`,
 * ou varredura do cron). Nunca lança; cada linha é isolada.
 */
export async function processAgendaNotificationOutbox(params?: {
  sb?: SupabaseServiceClient;
  outboxId?: string;
  limit?: number;
}): Promise<{ processed: number; sent: number; failed: number; pending: number }> {
  const counts = { processed: 0, sent: 0, failed: 0, pending: 0 };
  try {
    const sb = params?.sb ?? createSupabaseServiceClient();
    let query = sb
      .from(OUTBOX_TABLE)
      .select("id, tenant_id, agenda_event_id, action, operation_key, phone_last4, payload, status, attempts, last_error")
      .eq("status", "pending")
      .lt("attempts", MAX_SEND_ATTEMPTS)
      .order("updated_at", { ascending: true })
      .limit(Math.max(1, Math.min(params?.limit ?? 25, 100)));
    if (params?.outboxId) {
      query = query.eq("id", params.outboxId);
    }
    const { data, error } = await query;
    if (error) {
      console.warn("[agenda-notification-outbox] scan_failed", { error: error.message });
      return counts;
    }

    for (const row of (data ?? []) as OutboxRow[]) {
      counts.processed += 1;
      try {
        const outcome = await sendOutboxRow(sb, row);
        counts[outcome] += 1;
      } catch (rowError) {
        counts.pending += 1;
        console.warn("[agenda-notification-outbox] row_failed", {
          outbox_id: row.id,
          error: rowError instanceof Error ? rowError.message : String(rowError),
        });
      }
    }
    return counts;
  } catch (error) {
    console.warn("[agenda-notification-outbox] process_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return counts;
  }
}
