import "server-only";

import { randomUUID } from "node:crypto";
import {
  buildAppointmentOwnerNotificationText,
  type AppointmentNotificationAction,
} from "@/lib/server/agenda-owner-notifications";
import {
  getSystemAgentMetaConfig,
  refreshSystemAgentMetaTemplateStatus,
  sendSystemNotification,
} from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const OUTBOX_TABLE = "agenda_notification_outbox";
const MAX_SEND_ATTEMPTS = 5;
const CLAIM_TTL_SECONDS = 300;
/** Espera de webhook de entrega antes de reconsiderar reenvio de uma linha `sent`. */
const DELIVERY_WAIT_MINUTES = 15;
export const META_TEMPLATE_REQUIRED_ERROR = "meta_template_required";
export const META_TEMPLATE_NOT_APPROVED_ERROR = "meta_template_not_approved";
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
  payload: {
    phone?: string;
    message?: string;
    agent_id?: string | null;
    attendeeName?: string | null;
    attendeePhone?: string | null;
    startAtIso?: string | null;
    location?: string | null;
    timezone?: string | null;
  } | null;
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
      // Materializa skipped para o anti-join do reconciliador avançar (sem payload sensível).
      const { data: skipped, error: skipError } = await sb
        .from(OUTBOX_TABLE)
        .upsert(
          {
            tenant_id: params.tenantId,
            agenda_event_id: params.agendaEventId,
            action: params.action,
            operation_key: params.operationKey,
            phone_last4: null,
            payload: {},
            status: "skipped",
            last_error: "missing_appointment_notification_phone",
            next_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,operation_key,action", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (skipError) {
        console.warn("[agenda-notification-outbox] skip_materialize_failed", {
          tenant_id: params.tenantId,
          agenda_event_id: params.agendaEventId,
          error: skipError.message,
        });
        return { enqueued: false, outboxId: null };
      }
      console.info("[agenda-notification-outbox] skipped", {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        reason: "missing_appointment_notification_phone",
        outbox_id: skipped?.id ?? null,
      });
      return { enqueued: false, outboxId: (skipped?.id as string | undefined) ?? null };
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
      const { data: existing } = await sb
        .from(OUTBOX_TABLE)
        .select("id")
        .eq("tenant_id", params.tenantId)
        .eq("operation_key", params.operationKey)
        .eq("action", params.action)
        .maybeSingle();
      console.info("[agenda-notification-outbox] deduplicated", {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        action: params.action,
      });
      return {
        enqueued: false,
        outboxId: (existing?.id as string | undefined) ?? null,
      };
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
): Promise<boolean> {
  const { data, error } = await sb
    .from(OUTBOX_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("claim_token", row.claim_token)
    .select("id");
  if (error) {
    console.warn("[agenda-notification-outbox] finalize_failed", {
      outbox_id: row.id,
      error: error.message,
    });
    return false;
  }
  const updated = Array.isArray(data) ? data.length : 0;
  if (updated !== 1) {
    console.warn("[agenda-notification-outbox] finalize_inconclusive", {
      outbox_id: row.id,
      updated,
    });
    return false;
  }
  return true;
}

async function findCorrelatedNotificationLog(
  sb: SupabaseServiceClient,
  outboxId: string,
): Promise<{ status: string; error: string | null } | null> {
  const { data } = await sb
    .from("system_notifications_log")
    .select("status, error")
    .eq("metadata->>outbox_id", outboxId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    status: String((data as { status?: string }).status ?? ""),
    error: typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : null,
  };
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
  let message = row.payload?.message?.trim();
  if (!message && phone && row.payload?.startAtIso) {
    const timezone = row.payload.timezone?.trim() ||
      await resolveAgentTimezoneById(sb, row.tenant_id, row.payload.agent_id ?? null);
    message = buildAppointmentOwnerNotificationText({
      action: row.action,
      attendeeName: row.payload.attendeeName ?? null,
      attendeePhone: row.payload.attendeePhone ?? null,
      startAtIso: row.payload.startAtIso,
      timezone,
      location: row.payload.location ?? null,
    });
    row.payload = { ...row.payload, message, timezone };
    const hydrated = await updateClaimedRow(sb, row, { payload: row.payload });
    if (!hydrated) throw new Error("payload_hydration_inconclusive");
  }
  if (!phone || !message) {
    const ok = await updateClaimedRow(sb, row, {
      status: "failed",
      last_error: "invalid_outbox_payload",
      claim_token: null,
    });
    if (!ok) throw new Error("finalize_inconclusive");
    return "failed";
  }

  // At-most-once no reclaim: se já existe evidência correlacionada, não reenvia.
  const existingLog = await findCorrelatedNotificationLog(sb, row.id);
  if (existingLog && ["pending", "sent", "delivered"].includes(existingLog.status)) {
    if (existingLog.status === "delivered") {
      const ok = await updateClaimedRow(sb, row, {
        status: "delivered",
        delivered_at: new Date().toISOString(),
        last_error: null,
        claim_token: null,
      });
      if (!ok) throw new Error("finalize_inconclusive");
      return "sent";
    }
    const ok = await updateClaimedRow(sb, row, {
      status: "sent",
      last_error: null,
      claim_token: null,
      next_attempt_at: nextAttemptIso(DELIVERY_WAIT_MINUTES),
    });
    if (!ok) throw new Error("finalize_inconclusive");
    return "sent";
  }

  // Dispatch iniciado sem resultado observável → ambíguo; não reenviar às cegas.
  if (row.last_error === "dispatch_started" || row.last_error === "dispatch_ambiguous") {
    const ok = await updateClaimedRow(sb, row, {
      status: "pending",
      last_error: "dispatch_ambiguous",
      claim_token: null,
      next_attempt_at: nextAttemptIso(DELIVERY_WAIT_MINUTES),
    });
    if (!ok) throw new Error("finalize_inconclusive");
    console.warn("[agenda-notification-outbox] dispatch_ambiguous_no_resend", {
      outbox_id: row.id,
      tenant_id: row.tenant_id,
    });
    return "pending";
  }

  // Meta ativo sem template: mensagem proativa fora da janela de 24h exige
  // template aprovado. NÃO enviamos texto livre e NÃO marcamos entregue — volta
  // a pending com recuo, reenviável após o template ser configurado. Não conta
  // como tentativa de envio (attempts inalterado).
  const metaConfig = await getSystemAgentMetaConfig().catch(() => null);
  if (metaConfig?.active && !metaConfig.templateName) {
    const ok = await updateClaimedRow(sb, row, {
      status: "pending",
      last_error: META_TEMPLATE_REQUIRED_ERROR,
      claim_token: null,
      next_attempt_at: nextAttemptIso(META_TEMPLATE_BACKOFF_MINUTES),
    });
    if (!ok) throw new Error("finalize_inconclusive");
    console.warn("[agenda-notification-outbox] blocked", {
      outbox_id: row.id,
      tenant_id: row.tenant_id,
      action: row.action,
      reason: META_TEMPLATE_REQUIRED_ERROR,
      phone_last4: row.phone_last4,
    });
    return "pending";
  }
  if (metaConfig?.active && metaConfig.templateName && metaConfig.templateStatus !== "APPROVED") {
    const refreshed = await refreshSystemAgentMetaTemplateStatus().catch(
      () => metaConfig.templateStatus,
    );
    if (refreshed !== "APPROVED") {
      const ok = await updateClaimedRow(sb, row, {
        status: "pending",
        last_error: META_TEMPLATE_NOT_APPROVED_ERROR,
        claim_token: null,
        next_attempt_at: nextAttemptIso(META_TEMPLATE_BACKOFF_MINUTES),
      });
      if (!ok) throw new Error("finalize_inconclusive");
      return "pending";
    }
  }

  const attempts = row.attempts + 1;
  const attemptKey = `${row.id}:${attempts}`;
  const marked = await updateClaimedRow(sb, row, { last_error: "dispatch_started" });
  if (!marked) throw new Error("finalize_inconclusive");

  const sent = await sendSystemNotification(phone, message, "", {
    type: "appointment_notification",
    prePersistPending: true,
    metadata: {
      tenant_id: row.tenant_id,
      agenda_event_id: row.agenda_event_id,
      action: row.action,
      operation_key: row.operation_key,
      outbox_id: row.id,
      attempt_key: attemptKey,
      agent_id: row.payload?.agent_id ?? null,
      attendee_phone_last4: row.phone_last4,
    },
  }).catch((error) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
    debug: undefined,
  }));

  if (sent.ok) {
    const providerMessageId =
      (sent as { debug?: { evolutionMessageId?: string | null } }).debug?.evolutionMessageId ?? null;
    const ok = await updateClaimedRow(sb, row, {
      status: "sent",
      attempts,
      last_error: null,
      claim_token: null,
      provider_message_id: providerMessageId,
      next_attempt_at: nextAttemptIso(DELIVERY_WAIT_MINUTES),
    });
    if (!ok) {
      console.warn("[agenda-notification-outbox] finalize_inconclusive_after_accept", {
        outbox_id: row.id,
      });
      throw new Error("finalize_inconclusive");
    }
    return "sent";
  }

  const exhausted = attempts >= MAX_SEND_ATTEMPTS;
  const ok = await updateClaimedRow(sb, row, {
    status: exhausted ? "failed" : "pending",
    attempts,
    last_error: sent.error ?? "send_failed",
    claim_token: null,
    next_attempt_at: exhausted ? new Date().toISOString() : nextAttemptIso(retryBackoffMinutes(attempts)),
  });
  if (!ok) throw new Error("finalize_inconclusive");
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

const PERMANENT_DELIVERY_ERRORS = [
  "invalid_number",
  "missing_system_instance",
  "system_session_not_found",
  "system_session_not_authenticated",
] as const;

export function isPermanentDeliveryFailure(reason: string | null | undefined): boolean {
  const r = String(reason ?? "").toLowerCase();
  if (!r) return false;
  return PERMANENT_DELIVERY_ERRORS.some((p) => r.includes(p));
}

/**
 * Decisão pura de entrega a partir do system_notifications_log correlacionado.
 * Ausência de webhook (waitElapsed) NÃO autoriza reenvio automático.
 */
export function resolveDeliveryTransition(params: {
  logStatus: string | null | undefined;
  logError?: string | null;
  attempts: number;
  waitElapsed: boolean;
}): { status: OutboxStatus; retry: boolean } | null {
  const s = params.logStatus;
  if (s === "delivered") return { status: "delivered", retry: false };
  if (s === "delivery_failed" || s === "failed") {
    if (params.attempts >= MAX_SEND_ATTEMPTS || isPermanentDeliveryFailure(params.logError)) {
      return { status: "failed", retry: false };
    }
    return { status: "pending", retry: true };
  }
  // Sem evidência de falha: aguarda (mesmo após a janela). Não reenvia às cegas.
  void params.waitElapsed;
  return null;
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
      .select("id, attempts, updated_at, status")
      .in("status", ["sent", "pending"])
      .order("updated_at", { ascending: true })
      .limit(Math.max(1, Math.min(params?.limit ?? 50, 200)));
    if (error) {
      console.warn("[agenda-notification-outbox] delivery_scan_failed", { error: error.message });
      return counts;
    }

    for (const row of (data ?? []) as Array<{
      id: string;
      attempts: number;
      updated_at: string;
      status: string;
    }>) {
      counts.checked += 1;
      const { data: logRow } = await sb
        .from("system_notifications_log")
        .select("status, error, metadata")
        .eq("metadata->>outbox_id", row.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const logStatus = (logRow as { status?: string } | null)?.status;
      const logError =
        typeof (logRow as { error?: unknown } | null)?.error === "string"
          ? (logRow as { error: string }).error
          : typeof (logRow as { metadata?: { delivery_failure_reason?: unknown } } | null)?.metadata
                ?.delivery_failure_reason === "string"
            ? String(
                (logRow as { metadata: { delivery_failure_reason: string } }).metadata
                  .delivery_failure_reason,
              )
            : null;

      // delivered no log sempre promove a outbox (mesmo se pending pós-falha).
      if (logStatus === "delivered") {
        const { error: updErr } = await sb
          .from(OUTBOX_TABLE)
          .update({
            status: "delivered",
            delivered_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", row.id)
          .in("status", ["sent", "pending"]);
        if (!updErr) counts.delivered += 1;
        continue;
      }

      if (row.status !== "sent") continue;

      const waitElapsed =
        Date.now() - Date.parse(row.updated_at) > DELIVERY_WAIT_MINUTES * 60_000;
      const transition = resolveDeliveryTransition({
        logStatus,
        logError,
        attempts: row.attempts,
        waitElapsed,
      });
      if (!transition) continue;

      const patch: Record<string, unknown> =
        transition.status === "failed"
          ? { status: "failed", updated_at: new Date().toISOString() }
          : {
              status: "pending",
              next_attempt_at: nextAttemptIso(retryBackoffMinutes(row.attempts)),
              updated_at: new Date().toISOString(),
            };

      const { error: updErr } = await sb.from(OUTBOX_TABLE).update(patch).eq("id", row.id).eq("status", "sent");
      if (updErr) continue;
      if (transition.status === "failed") counts.failed += 1;
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
 * Reconciliador de durabilidade via RPC anti-join paginada (cursor ASC).
 * Materializa skipped quando não há telefone. Idempotente. Nunca lança.
 */
export async function reconcileMissingAgendaNotifications(params?: {
  sb?: SupabaseServiceClient;
  limit?: number;
  maxBatches?: number;
}): Promise<{ scanned: number; recreated: number; skipped: number }> {
  const counts = { scanned: 0, recreated: 0, skipped: 0 };
  try {
    const sb = params?.sb ?? createSupabaseServiceClient();
    const pageSize = Math.max(1, Math.min(params?.limit ?? 100, 500));
    const maxBatches = Math.max(1, Math.min(params?.maxBatches ?? 20, 100));
    let cursorUpdatedAt: string | null = null;
    let cursorId: string | null = null;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const { data, error } = await sb.rpc("list_missing_agenda_notification_ops", {
        p_cursor_updated_at: cursorUpdatedAt,
        p_cursor_id: cursorId,
        p_limit: pageSize,
      });
      if (error) {
        console.warn("[agenda-notification-outbox] missing_scan_failed", { error: error.message });
        return counts;
      }

      const rows = (data ?? []) as Array<{
        tenant_id: string;
        operation_key: string;
        updated_at: string;
        operation_id: string;
        result: Record<string, unknown> | null;
      }>;
      if (!rows.length) break;

      for (const op of rows) {
        cursorUpdatedAt = op.updated_at;
        cursorId = op.operation_id;
        const result = op.result ?? {};
        const action = result["action"] as AppointmentNotificationAction | undefined;
        const event = result["event"] as Record<string, unknown> | null;
        if (!action || !event?.["id"]) continue;
        counts.scanned += 1;

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

      if (rows.length < pageSize) break;
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
