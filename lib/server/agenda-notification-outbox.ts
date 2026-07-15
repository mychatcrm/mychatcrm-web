import "server-only";

import { randomUUID } from "node:crypto";
import {
  buildAppointmentOwnerNotificationText,
  type AppointmentNotificationAction,
} from "@/lib/server/agenda-owner-notifications";
import { getSystemAgentMetaConfig, sendSystemNotification } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const OUTBOX_TABLE = "agenda_notification_outbox";
const MAX_SEND_ATTEMPTS = 5;
const CLAIM_TTL_SECONDS = 300;
/** Espera de webhook de entrega antes de reconsiderar reenvio de uma linha `sent`. */
const DELIVERY_WAIT_MINUTES = 15;
export const META_TEMPLATE_REQUIRED_ERROR = "meta_template_required";
/** Recuo enquanto o template Meta não está configurado (reenviável depois). */
const META_TEMPLATE_BACKOFF_MINUTES = 60;

type OutboxStatus = "pending" | "processing" | "sent" | "delivered" | "failed" | "skipped";

type OutboxRow = {
  id: string;
  tenant_id: string;
  agenda_event_id: string | null;
  action: AppointmentNotificationAction;
  operation_key: string;
  phone_last4: string | null;
  payload: { phone?: string; message?: string; agent_id?: string | null } | null;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  claim_token: string | null;
  provider_message_id?: string | null;
};

function phoneLast4(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

/** Backoff exponencial capado (minutos), por número de tentativas já feitas. */
export function retryBackoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts), 60);
}

function nextAttemptIso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

/**
 * Enfileira o aviso ao dono APÓS uma mutação de agenda confirmada. Idempotente
 * por (tenant_id, operation_key, action). Nunca lança — a falha ao enfileirar
 * não pode derrubar a mutação já commitada (o reconciliador recupera depois).
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
          next_attempt_at: new Date().toISOString(),
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

/** Finaliza uma linha reivindicada, condicionado ao claim_token (evita roubo). */
async function updateClaimedRow(
  sb: SupabaseServiceClient,
  row: OutboxRow,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb
    .from(OUTBOX_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("claim_token", row.claim_token);
  if (error) {
    console.warn("[agenda-notification-outbox] finalize_failed", {
      outbox_id: row.id,
      error: error.message,
    });
  }
}

/** Reivindica UMA linha específica por id (envio inline pós-mutação). */
async function claimOutboxRowById(
  sb: SupabaseServiceClient,
  outboxId: string,
): Promise<OutboxRow | null> {
  const token = randomUUID();
  const { data, error } = await sb
    .from(OUTBOX_TABLE)
    .update({ status: "processing", claim_token: token, claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", outboxId)
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .select("id, tenant_id, agenda_event_id, action, operation_key, phone_last4, payload, status, attempts, last_error, claim_token, provider_message_id")
    .maybeSingle();
  if (error) {
    console.warn("[agenda-notification-outbox] claim_by_id_failed", { outbox_id: outboxId, error: error.message });
    return null;
  }
  return (data as OutboxRow | null) ?? null;
}

/** Reivindica um lote via RPC (FOR UPDATE SKIP LOCKED), incluindo claims abandonados. */
async function claimOutboxBatch(sb: SupabaseServiceClient, limit: number): Promise<OutboxRow[]> {
  const { data, error } = await sb.rpc("claim_agenda_notifications", {
    p_limit: limit,
    p_claim_ttl_seconds: CLAIM_TTL_SECONDS,
  });
  if (error) {
    console.warn("[agenda-notification-outbox] claim_batch_failed", { error: error.message });
    return [];
  }
  return ((data ?? []) as OutboxRow[]).filter((row) => row.claim_token);
}

/** Envia uma linha JÁ reivindicada. Só o dono do claim_token finaliza. */
async function sendClaimedRow(sb: SupabaseServiceClient, row: OutboxRow): Promise<"sent" | "failed" | "pending"> {
  const phone = row.payload?.phone?.trim();
  const message = row.payload?.message?.trim();
  if (!phone || !message) {
    await updateClaimedRow(sb, row, { status: "failed", last_error: "invalid_outbox_payload", claim_token: null });
    return "failed";
  }

  // Meta ativo sem template: mensagem proativa fora da janela de 24h exige
  // template aprovado. NÃO enviamos texto livre e NÃO marcamos entregue — volta
  // a pending com recuo, reenviável após o template ser configurado. Não conta
  // como tentativa de envio (attempts inalterado).
  const metaConfig = await getSystemAgentMetaConfig().catch(() => null);
  if (metaConfig?.active && !metaConfig.templateName) {
    await updateClaimedRow(sb, row, {
      status: "pending",
      last_error: META_TEMPLATE_REQUIRED_ERROR,
      claim_token: null,
      next_attempt_at: nextAttemptIso(META_TEMPLATE_BACKOFF_MINUTES),
    });
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
    debug: undefined,
  }));

  if (sent.ok) {
    // Aceite do provedor: 'sent' NÃO é terminal — aguarda webhook de entrega. O
    // reconciliador de delivery promove a 'delivered' ou devolve a retry.
    const providerMessageId =
      (sent as { debug?: { evolutionMessageId?: string | null } }).debug?.evolutionMessageId ?? null;
    await updateClaimedRow(sb, row, {
      status: "sent",
      attempts,
      last_error: null,
      claim_token: null,
      provider_message_id: providerMessageId,
      next_attempt_at: nextAttemptIso(DELIVERY_WAIT_MINUTES),
    });
    return "sent";
  }

  const exhausted = attempts >= MAX_SEND_ATTEMPTS;
  await updateClaimedRow(sb, row, {
    status: exhausted ? "failed" : "pending",
    attempts,
    last_error: sent.error ?? "send_failed",
    claim_token: null,
    next_attempt_at: exhausted ? new Date().toISOString() : nextAttemptIso(retryBackoffMinutes(attempts)),
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
 * Processa o outbox. Com `outboxId`: reivindica e envia só aquela linha (envio
 * inline pós-mutação). Sem `outboxId`: reivindica um lote (cron). O claim
 * garante que envio inline e cron nunca disputem a mesma linha.
 */
export async function processAgendaNotificationOutbox(params?: {
  sb?: SupabaseServiceClient;
  outboxId?: string;
  limit?: number;
}): Promise<{ processed: number; sent: number; failed: number; pending: number }> {
  const counts = { processed: 0, sent: 0, failed: 0, pending: 0 };
  try {
    const sb = params?.sb ?? createSupabaseServiceClient();
    const rows = params?.outboxId
      ? ([await claimOutboxRowById(sb, params.outboxId)].filter(Boolean) as OutboxRow[])
      : await claimOutboxBatch(sb, params?.limit ?? 25);

    for (const row of rows) {
      counts.processed += 1;
      try {
        counts[await sendClaimedRow(sb, row)] += 1;
      } catch (rowError) {
        counts.pending += 1;
        // Libera o claim para retry futuro; a linha volta a pending pelo TTL.
        await updateClaimedRow(sb, row, { status: "pending", claim_token: null }).catch(() => undefined);
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

/**
 * Decisão pura de entrega a partir do status do system_notifications_log
 * correlacionado por outbox_id. Retorna o próximo estado da linha `sent`.
 */
export function resolveDeliveryTransition(params: {
  logStatus: string | null | undefined;
  attempts: number;
  waitElapsed: boolean;
}): { status: OutboxStatus; retry: boolean } | null {
  const s = params.logStatus;
  if (s === "delivered") return { status: "delivered", retry: false };
  if (s === "delivery_failed" || s === "failed") {
    if (params.attempts >= MAX_SEND_ATTEMPTS) return { status: "failed", retry: false };
    return { status: "pending", retry: true };
  }
  // Sem confirmação e a janela de espera de webhook estourou → reenvio.
  if (params.waitElapsed) {
    if (params.attempts >= MAX_SEND_ATTEMPTS) return { status: "failed", retry: false };
    return { status: "pending", retry: true };
  }
  return null; // ainda aguardando webhook dentro da janela
}

/**
 * Reconcilia linhas `sent` com o system_notifications_log (por outbox_id):
 * promove a `delivered`, ou devolve a retry/`failed`. Reaproveita a máquina de
 * entrega existente — sem segundo rastreador paralelo. Nunca lança.
 */
export async function reconcileAgendaOutboxDelivery(params?: {
  sb?: SupabaseServiceClient;
  limit?: number;
}): Promise<{ checked: number; delivered: number; retried: number; failed: number }> {
  const counts = { checked: 0, delivered: 0, retried: 0, failed: 0 };
  try {
    const sb = params?.sb ?? createSupabaseServiceClient();
    const { data, error } = await sb
      .from(OUTBOX_TABLE)
      .select("id, attempts, updated_at")
      .eq("status", "sent")
      .order("updated_at", { ascending: true })
      .limit(Math.max(1, Math.min(params?.limit ?? 50, 200)));
    if (error) {
      console.warn("[agenda-notification-outbox] delivery_scan_failed", { error: error.message });
      return counts;
    }

    for (const row of (data ?? []) as Array<{ id: string; attempts: number; updated_at: string }>) {
      counts.checked += 1;
      const { data: logRow } = await sb
        .from("system_notifications_log")
        .select("status")
        .eq("metadata->>outbox_id", row.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const waitElapsed =
        Date.now() - Date.parse(row.updated_at) > DELIVERY_WAIT_MINUTES * 60_000;
      const transition = resolveDeliveryTransition({
        logStatus: (logRow as { status?: string } | null)?.status,
        attempts: row.attempts,
        waitElapsed,
      });
      if (!transition) continue;

      const patch: Record<string, unknown> =
        transition.status === "delivered"
          ? { status: "delivered", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : transition.status === "failed"
            ? { status: "failed", updated_at: new Date().toISOString() }
            : { status: "pending", next_attempt_at: nextAttemptIso(retryBackoffMinutes(row.attempts)), updated_at: new Date().toISOString() };

      const { error: updErr } = await sb.from(OUTBOX_TABLE).update(patch).eq("id", row.id).eq("status", "sent");
      if (updErr) continue;
      if (transition.status === "delivered") counts.delivered += 1;
      else if (transition.status === "failed") counts.failed += 1;
      else counts.retried += 1;
    }
    return counts;
  } catch (error) {
    console.warn("[agenda-notification-outbox] delivery_reconcile_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return counts;
  }
}

/**
 * Reconciliador de durabilidade (lacuna: enqueue fora da transação da RPC pode
 * falhar após o commit). Reconstrói obrigações ausentes a partir das mutações
 * já confirmadas em agenda_mutation_operations. Determinístico e idempotente
 * (UNIQUE tenant+operation_key+action). Nunca lança.
 */
export async function reconcileMissingAgendaNotifications(params?: {
  sb?: SupabaseServiceClient;
  maxAgeMinutes?: number;
  limit?: number;
}): Promise<{ scanned: number; recreated: number; skipped: number }> {
  const counts = { scanned: 0, recreated: 0, skipped: 0 };
  try {
    const sb = params?.sb ?? createSupabaseServiceClient();
    const sinceIso = new Date(Date.now() - (params?.maxAgeMinutes ?? 1440) * 60_000).toISOString();
    const { data, error } = await sb
      .from("agenda_mutation_operations")
      .select("tenant_id, operation_key, result")
      .in("status", ["local_committed", "completed"])
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .limit(Math.max(1, Math.min(params?.limit ?? 100, 500)));
    if (error) {
      console.warn("[agenda-notification-outbox] missing_scan_failed", { error: error.message });
      return counts;
    }

    for (const op of (data ?? []) as Array<{ tenant_id: string; operation_key: string; result: Record<string, unknown> | null }>) {
      const result = op.result ?? {};
      const changed = result["changed"] === true;
      const action = result["action"] as AppointmentNotificationAction | undefined;
      const event = result["event"] as Record<string, unknown> | null;
      if (!changed || !action || !event?.["id"]) continue;
      counts.scanned += 1;

      const { data: existing } = await sb
        .from(OUTBOX_TABLE)
        .select("id")
        .eq("tenant_id", op.tenant_id)
        .eq("operation_key", op.operation_key)
        .eq("action", action)
        .maybeSingle();
      if (existing?.id) continue;

      const agentId = (event["agent_id"] as string | null) ?? null;
      const timezone = await resolveAgentTimezoneById(sb, op.tenant_id, agentId);
      const enq = await enqueueAgendaOwnerNotification({
        sb,
        tenantId: op.tenant_id,
        agendaEventId: String(event["id"]),
        action,
        operationKey: op.operation_key,
        attendeeName: (event["attendee_name"] as string | null) ?? null,
        attendeePhone: (event["attendee_phone"] as string | null) ?? null,
        startAtIso: String(event["start_at"] ?? ""),
        location: (event["location"] as string | null) ?? null,
        timezone,
        agentId,
      });
      if (enq.enqueued) counts.recreated += 1;
      else counts.skipped += 1;
    }
    return counts;
  } catch (error) {
    console.warn("[agenda-notification-outbox] missing_reconcile_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return counts;
  }
}

async function resolveAgentTimezoneById(
  sb: SupabaseServiceClient,
  tenantId: string,
  agentId: string | null,
): Promise<string> {
  const fallback = "America/Sao_Paulo";
  if (!agentId) return fallback;
  try {
    const { data } = await sb
      .from("tenant_agents")
      .select("metadata")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agentId)
      .maybeSingle();
    const tz = (data as { metadata?: { timezone?: unknown } } | null)?.metadata?.timezone;
    return typeof tz === "string" && tz.trim() ? tz.trim() : fallback;
  } catch {
    return fallback;
  }
}
