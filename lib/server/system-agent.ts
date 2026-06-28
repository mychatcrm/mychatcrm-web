import {
  evolutionConnectionState,
  evolutionFetchInstances,
  evolutionRestartInstance,
  evolutionSendText,
  isEvolutionConnectionClosedError,
  isEvolutionDeliveryErrorStatus,
  isEvolutionPendingStatus,
  isEvolutionSentAckStatus,
  normalizeEvolutionConnectionState,
  parseEvolutionConnectionStatePayload,
  pickEvolutionInstanceInfo,
  resolveEvolutionSendNumber,
} from "@/lib/integrations/evolution-api";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";

export const SYSTEM_AGENT_ID = "mychatcrm-system-agent";
export const SYSTEM_TENANT_ID = "tenant-system-internal";

export async function getSystemAgentInstanceName(): Promise<string | null> {
  const row = await getEvolutionInstanceByTenantId(SYSTEM_TENANT_ID);
  return row?.instance_name?.trim() || null;
}

export type SystemAgentSession = {
  instanceName: string | null;
  connectionState: string;
  ownerJid: string | null;
  profileName: string | null;
  /** true só quando a sessão WhatsApp está REALMENTE autenticada (open + ownerJid). */
  authenticated: boolean;
  source: "fetchInstances" | "connectionState" | "none";
};

/**
 * Identidade real da sessão do agente do sistema.
 * Usa `fetchInstances` (traz `ownerJid`) como fonte de verdade — o endpoint
 * `connectionState` pode reportar "open" numa sessão zumbi (aceita API, não entrega).
 * Faz fallback para `connectionState` apenas quando `fetchInstances` está indisponível.
 */
export async function getSystemAgentSession(): Promise<SystemAgentSession> {
  const instanceName = await getSystemAgentInstanceName();
  if (!instanceName) {
    return {
      instanceName: null,
      connectionState: "none",
      ownerJid: null,
      profileName: null,
      authenticated: false,
      source: "none",
    };
  }

  const instances = await evolutionFetchInstances(instanceName);
  if (instances.ok) {
    const info = pickEvolutionInstanceInfo(instances.data, instanceName);
    if (info) {
      const connectionState = info.connectionStatus ?? "unknown";
      return {
        instanceName,
        connectionState,
        ownerJid: info.ownerJid,
        profileName: info.profileName,
        authenticated: connectionState === "open" && Boolean(info.ownerJid),
        source: "fetchInstances",
      };
    }
  }

  const state = await evolutionConnectionState(instanceName);
  const connectionState = state.ok
    ? normalizeEvolutionConnectionState(parseEvolutionConnectionStatePayload(state.data), "close")
    : "unknown";

  return {
    instanceName,
    connectionState,
    ownerJid: null,
    profileName: null,
    authenticated: state.ok && connectionState === "open",
    source: "connectionState",
  };
}

export async function isSystemAgentReady(): Promise<{
  ready: boolean;
  instanceName: string | null;
  connectionState: string;
}> {
  const session = await getSystemAgentSession();
  return {
    ready: session.authenticated,
    instanceName: session.instanceName,
    connectionState: session.connectionState,
  };
}

/**
 * Normaliza um número de telefone brasileiro para o formato esperado pela Evolution API.
 * A Evolution API exige dígitos com código de país (ex: 5562993580574).
 *
 * Regras:
 *  - 13 dígitos → já tem 55 + DDD 2 dígitos + número 9 dígitos → ok
 *  - 12 dígitos → já tem 55 + DDD 2 dígitos + número 8 dígitos → ok
 *  - 11 dígitos → DDD 2 + número 9 dígitos → adiciona "55"
 *  - 10 dígitos → DDD 2 + número 8 dígitos → adiciona "55"
 *  - outros    → retorna sem modificar (país desconhecido ou inválido)
 */
export function normalizeBrazilianPhoneNumber(digits: string): string {
  if (digits.length === 10 || digits.length === 11) {
    return "55" + digits;
  }
  return digits;
}

function isValidBrazilianWhatsAppNumber(digits: string): boolean {
  return digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
}

async function logSystemNotification(params: {
  type: string;
  toNumber: string;
  message: string;
  status: "sent" | "failed" | "delivery_failed" | "delivered" | "pending" | "skipped";
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    await sb.from("system_notifications_log").insert({
      type: params.type,
      to_number: params.toNumber,
      message: params.message.slice(0, 4000),
      status: params.status,
      error: params.error ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (error) {
    console.warn("[system-agent] log_failed", {
      error: error instanceof Error ? error.message : "log_failed",
    });
  }
}

function readEvolutionPayloadString(payload: unknown, path: string[]): string | null {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function extractEvolutionMessageId(payload: unknown): string | null {
  return (
    readEvolutionPayloadString(payload, ["key", "id"]) ||
    readEvolutionPayloadString(payload, ["message", "key", "id"]) ||
    readEvolutionPayloadString(payload, ["data", "key", "id"]) ||
    readEvolutionPayloadString(payload, ["id"])
  );
}

function detectEvolutionPayloadFailure(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (data.status === false) return "evolution_payload_status_false";
  if (data.success === false) return "evolution_payload_success_false";
  if (isEvolutionDeliveryErrorStatus(data.status)) return "evolution_delivery_error_status";
  if (typeof data.error === "string" && data.error.trim()) return data.error.trim().slice(0, 500);

  const response = data.response;
  if (response && typeof response === "object") {
    const message = (response as Record<string, unknown>).message;
    if (Array.isArray(message)) {
      const joined = message.filter((item): item is string => typeof item === "string").join(" · ").trim();
      if (joined) return joined.slice(0, 500);
    }
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 500);
  }

  const key = data.key;
  if (key && typeof key === "object") {
    const keyStatus = (key as Record<string, unknown>).status;
    if (isEvolutionDeliveryErrorStatus(keyStatus)) return "evolution_delivery_error_status";
  }

  return null;
}

function extractEvolutionResponseStatus(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return null;
  return (payload as Record<string, unknown>).status ?? null;
}

const CRITICAL_SYSTEM_NOTIFICATION_TYPES = new Set([
  "account_phone_removed",
  "admin_test",
  "handoff_alert",
  "integration_disconnected",
  "phone_verification_code",
]);

function resolveNotificationLogStatus(responseStatus: unknown): "sent" | "pending" {
  if (isEvolutionSentAckStatus(responseStatus)) return "sent";
  if (isEvolutionPendingStatus(responseStatus)) return "pending";
  // message_id sem status explícito — conservador: aguardando WhatsApp
  return "pending";
}

function shouldTryReliableBrazilianVariants(type: string | undefined): boolean {
  return Boolean(type && CRITICAL_SYSTEM_NOTIFICATION_TYPES.has(type));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendEvolutionTextWithRestartRetry(params: {
  instanceName: string;
  number: string;
  text: string;
}): Promise<Awaited<ReturnType<typeof evolutionSendText>> & { restarted?: boolean }> {
  let restarted = false;

  const attempt = () =>
    evolutionSendText({
      instanceName: params.instanceName,
      number: params.number,
      text: params.text,
    });

  let send = await attempt();
  const payloadFailure = send.ok ? detectEvolutionPayloadFailure(send.data) : null;
  const connectionIssue =
    (!send.ok && isEvolutionConnectionClosedError(send.error)) ||
    isEvolutionConnectionClosedError(payloadFailure);

  if (connectionIssue && !restarted) {
    const restart = await evolutionRestartInstance(params.instanceName);
    restarted = restart.ok;
    if (restart.ok) {
      await sleep(2500);
      const state = await evolutionConnectionState(params.instanceName);
      const liveState = state.ok
        ? normalizeEvolutionConnectionState(parseEvolutionConnectionStatePayload(state.data), "close")
        : "unknown";
      if (state.ok && liveState === "open") {
        send = await attempt();
      }
    }
  }

  return { ...send, restarted };
}

type SystemNotificationRow = { id: string; status: string; metadata: Record<string, unknown> | null };

/**
 * Localiza a notificação do sistema correspondente a um message_id da Evolution.
 * Considera tanto o `evolution_message_id` primário quanto o array `evolution_message_ids`
 * (notificações críticas podem ter sido enviadas em mais de um formato de número).
 */
async function findSystemNotificationByMessageId(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  evolutionMessageId: string,
): Promise<SystemNotificationRow | null> {
  const primary = await sb
    .from("system_notifications_log")
    .select("id, status, metadata")
    .filter("metadata->>evolution_message_id", "eq", evolutionMessageId)
    .order("created_at", { ascending: false })
    .limit(1);
  const primaryRow = primary.data?.[0] as SystemNotificationRow | undefined;
  if (primaryRow) return primaryRow;

  const inArray = await sb
    .from("system_notifications_log")
    .select("id, status, metadata")
    .contains("metadata", { evolution_message_ids: [evolutionMessageId] })
    .order("created_at", { ascending: false })
    .limit(1);
  return (inArray.data?.[0] as SystemNotificationRow | undefined) ?? null;
}

export async function markSystemNotificationDeliveryFailed(params: {
  evolutionMessageId: string;
  reason: string;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const row = await findSystemNotificationByMessageId(sb, params.evolutionMessageId);
    if (!row || row.status === "delivery_failed") return;

    const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};

    await sb
      .from("system_notifications_log")
      .update({
        status: "delivery_failed",
        error: params.reason.slice(0, 500),
        metadata: {
          ...meta,
          delivery_failed_at: new Date().toISOString(),
          delivery_failure_reason: params.reason.slice(0, 500),
        },
      })
      .eq("id", row.id);
  } catch (error) {
    console.error("[system-agent] delivery_failed_update", {
      evolutionMessageId: params.evolutionMessageId,
      error: error instanceof Error ? error.message : "update_failed",
    });
  }
}

/** Marca a notificação como entregue (DELIVERY_ACK/READ/PLAYED) confirmada via webhook. */
export async function markSystemNotificationDelivered(params: {
  evolutionMessageId: string;
  status?: unknown;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const row = await findSystemNotificationByMessageId(sb, params.evolutionMessageId);
    if (!row || row.status === "delivered" || row.status === "delivery_failed") return;

    const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};

    await sb
      .from("system_notifications_log")
      .update({
        status: "delivered",
        error: null,
        metadata: {
          ...meta,
          delivered_at: new Date().toISOString(),
          delivery_status: params.status ?? null,
        },
      })
      .eq("id", row.id);
  } catch (error) {
    console.error("[system-agent] delivered_update", {
      evolutionMessageId: params.evolutionMessageId,
      error: error instanceof Error ? error.message : "update_failed",
    });
  }
}

export async function sendSystemNotification(
  toNumber: string,
  message: string,
  instanceName: string,
  options?: {
    type?: string;
    metadata?: Record<string, unknown> | null;
  },
): Promise<{
  ok: boolean;
  error?: string;
  debug?: {
    numberSent?: string;
    candidatesTried?: string[];
    evolutionMessageId?: string | null;
    evolutionMessageIds?: string[];
    evolutionResponseStatus?: unknown;
    sessionRestarted?: boolean;
  };
}> {
  const rawDigits = toNumber.replace(/\D/g, "");
  const digits = normalizeBrazilianPhoneNumber(rawDigits);

  if (!isValidBrazilianWhatsAppNumber(digits)) {
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits || toNumber,
      message,
      status: "failed",
      error: "invalid_number",
      metadata: options?.metadata ?? null,
    });
    return { ok: false, error: "invalid_number" };
  }

  const resolvedInstance = instanceName.trim() || (await getSystemAgentInstanceName());

  if (!resolvedInstance) {
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits,
      message,
      status: "failed",
      error: "missing_system_instance",
      metadata: options?.metadata ?? null,
    });
    return { ok: false, error: "missing_system_instance" };
  }

  const state = await evolutionConnectionState(resolvedInstance);
  const liveState = state.ok
    ? normalizeEvolutionConnectionState(parseEvolutionConnectionStatePayload(state.data), "close")
    : "unknown";
  if (!state.ok || liveState !== "open") {
    const error = state.ok ? `system_instance_not_open:${liveState}` : `system_instance_state_check_failed:${state.error}`;
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits,
      message,
      status: "failed",
      error,
      metadata: {
        ...(options?.metadata ?? {}),
        instance_name: resolvedInstance,
        number_raw: rawDigits,
        number_normalized: digits,
        evolution_connection_state: liveState,
      },
    });
    return { ok: false, error };
  }

  // Fonte de verdade da identidade: fetchInstances traz ownerJid quando a sessão está REALMENTE
  // autenticada. Falha fechada: sem fetchInstances não enviamos (evita sessão zumbi).
  let sessionOwnerJid: string | null = null;
  let sessionConnectionStatus: string | null = null;
  const instancesRes = await evolutionFetchInstances(resolvedInstance);
  if (!instancesRes.ok) {
    const reason = `system_session_check_failed:${instancesRes.error ?? "fetchInstances_failed"}`;
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits,
      message,
      status: "failed",
      error: reason,
      metadata: {
        ...(options?.metadata ?? {}),
        instance_name: resolvedInstance,
        number_raw: rawDigits,
        number_normalized: digits,
        evolution_connection_state: liveState,
      },
    });
    return { ok: false, error: reason };
  }

  const info = pickEvolutionInstanceInfo(instancesRes.data, resolvedInstance);
  if (!info) {
    const reason = "system_session_not_found_in_evolution";
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits,
      message,
      status: "failed",
      error: reason,
      metadata: {
        ...(options?.metadata ?? {}),
        instance_name: resolvedInstance,
        number_raw: rawDigits,
        number_normalized: digits,
        evolution_connection_state: liveState,
      },
    });
    return { ok: false, error: reason };
  }

  sessionOwnerJid = info.ownerJid;
  sessionConnectionStatus = info.connectionStatus;
  const authenticated = info.connectionStatus === "open" && Boolean(info.ownerJid);
  if (!authenticated) {
    const reason =
      info.connectionStatus && info.connectionStatus !== "open"
        ? `system_session_not_authenticated:${info.connectionStatus}`
        : "system_session_not_authenticated:no_owner";
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits,
      message,
      status: "failed",
      error: reason,
      metadata: {
        ...(options?.metadata ?? {}),
        instance_name: resolvedInstance,
        number_raw: rawDigits,
        number_normalized: digits,
        evolution_connection_state: liveState,
        session_connection_status: info.connectionStatus,
        session_owner_jid: info.ownerJid,
      },
    });
    return { ok: false, error: reason };
  }

  // Valida existência no WhatsApp e prepara as variantes brasileiras reconhecidas pela Evolution.
  const resolution = await resolveEvolutionSendNumber({ instanceName: resolvedInstance, number: digits });

  if (resolution.status === "not_found") {
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits,
      message,
      status: "failed",
      error: "number_not_on_whatsapp",
      metadata: {
        ...(options?.metadata ?? {}),
        instance_name: resolvedInstance,
        number_raw: rawDigits,
        number_normalized: digits,
        evolution_connection_state: liveState,
        evolution_number_check: "not_found",
        resolved_jid: resolution.jid,
      },
    });
    return { ok: false, error: "number_not_on_whatsapp" };
  }

  const numberCheck = resolution.status;
  const platformNumber =
    resolution.status === "exists" || resolution.status === "check_failed"
      ? resolution.platformNumber
      : digits;
  const preferredSendNumber =
    resolution.status === "exists" && resolution.sendNumber ? resolution.sendNumber : platformNumber;
  const candidateNumbers = Array.from(
    new Set(
      [
        preferredSendNumber,
        ...(resolution.status === "exists" || resolution.status === "check_failed"
          ? resolution.candidateNumbers
          : []),
        platformNumber,
      ].filter((candidate): candidate is string => Boolean(candidate && candidate.length >= 12)),
    ),
  );
  const resolvedJid = resolution.status === "exists" ? resolution.jid : null;

  const tryAllCriticalVariants = shouldTryReliableBrazilianVariants(options?.type);
  type SendAttempt = {
    number: string;
    ok: boolean;
    error: string | null;
    payloadFailure: string | null;
    messageId: string | null;
    responseStatus: unknown;
    restarted: boolean;
  };

  const attempts: SendAttempt[] = [];
  const successfulAttempts: SendAttempt[] = [];
  let sendNumber = candidateNumbers[0] ?? platformNumber;
  const tried: string[] = [];

  for (const candidate of candidateNumbers) {
    tried.push(candidate);
    const attempt = await sendEvolutionTextWithRestartRetry({
      instanceName: resolvedInstance,
      number: candidate,
      text: message.slice(0, 4000),
    });
    sendNumber = candidate;
    const attemptFailure = attempt.ok ? detectEvolutionPayloadFailure(attempt.data) : null;
    const messageId = attempt.ok ? extractEvolutionMessageId(attempt.data) : null;
    const responseStatus = attempt.ok ? extractEvolutionResponseStatus(attempt.data) : null;
    const sendAttempt: SendAttempt = {
      number: candidate,
      ok: attempt.ok,
      error: attempt.ok ? null : attempt.error,
      payloadFailure: attemptFailure,
      messageId,
      responseStatus,
      restarted: attempt.restarted === true,
    };
    attempts.push(sendAttempt);

    if (attempt.ok && !attemptFailure && messageId) {
      successfulAttempts.push(sendAttempt);
      const shouldTryNextVariant =
        tryAllCriticalVariants && isEvolutionPendingStatus(responseStatus) && tried.length < candidateNumbers.length;
      if (shouldTryNextVariant) continue;
      break;
    }
    if (attempt.ok && !attemptFailure && !messageId) {
      // Resposta aceita sem ID não é suficiente para considerar entregue; tenta o próximo formato.
      continue;
    }
    if (!attempt.ok && !isEvolutionConnectionClosedError(attempt.error)) {
      // HTTP error unrelated to session — try next number format before giving up.
      continue;
    }
    if (attemptFailure && !isEvolutionConnectionClosedError(attemptFailure)) {
      continue;
    }
    break;
  }

  if (!attempts.length) {
    return { ok: false, error: "evolution_send_failed" };
  }

  const lastAttempt = attempts[attempts.length - 1];
  const successfulAttempt = successfulAttempts[successfulAttempts.length - 1] ?? null;
  const evolutionMessageIds = successfulAttempts
    .map((attempt) => attempt.messageId)
    .filter((messageId): messageId is string => Boolean(messageId));
  const evolutionMessageId = successfulAttempt?.messageId ?? null;
  const evolutionResponseStatus = successfulAttempt?.responseStatus ?? lastAttempt.responseStatus;
  const finalOk = Boolean(successfulAttempt);
  const finalError = finalOk
    ? null
    : lastAttempt.ok
      ? lastAttempt.payloadFailure ?? "missing_evolution_message_id"
      : lastAttempt.error;

  const logStatus = finalOk ? resolveNotificationLogStatus(evolutionResponseStatus) : "failed";

  await logSystemNotification({
    type: options?.type ?? "generic",
    toNumber: platformNumber,
    message,
    status: logStatus,
    error: finalOk ? null : finalError,
    metadata: {
      ...(options?.metadata ?? {}),
      instance_name: resolvedInstance,
      number_raw: rawDigits,
      number_normalized: platformNumber,
      number_sent: successfulAttempt?.number ?? sendNumber,
      numbers_tried: tried,
      resolved_jid: resolvedJid,
      session_owner_jid: sessionOwnerJid,
      session_connection_status: sessionConnectionStatus,
      evolution_number_check: numberCheck,
      evolution_connection_state: liveState,
      evolution_message_id: evolutionMessageId,
      evolution_message_ids: evolutionMessageIds,
      evolution_response_status: evolutionResponseStatus,
      evolution_attempts: attempts.map((attempt) => ({
        number: attempt.number,
        ok: attempt.ok,
        error: attempt.error,
        payload_failure: attempt.payloadFailure,
        message_id: attempt.messageId,
        response_status: attempt.responseStatus,
        restarted: attempt.restarted,
      })),
      evolution_session_restarted: attempts.some((attempt) => attempt.restarted),
    },
  });

  const debug = {
    numberSent: successfulAttempt?.number ?? sendNumber,
    candidatesTried: tried,
    evolutionMessageId,
    evolutionMessageIds,
    evolutionResponseStatus,
    sessionRestarted: attempts.some((attempt) => attempt.restarted),
  };

  if (!finalOk) return { ok: false, error: finalError ?? "evolution_send_failed", debug };
  return { ok: true, debug };
}
