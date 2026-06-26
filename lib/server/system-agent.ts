import {
  evolutionConnectionState,
  evolutionRestartInstance,
  evolutionSendText,
  isEvolutionConnectionClosedError,
  isEvolutionDeliveryErrorStatus,
  normalizeEvolutionConnectionState,
  parseEvolutionConnectionStatePayload,
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

export async function isSystemAgentReady(): Promise<{
  ready: boolean;
  instanceName: string | null;
  connectionState: string;
}> {
  const instanceName = await getSystemAgentInstanceName();
  if (!instanceName) {
    return { ready: false, instanceName: null, connectionState: "none" };
  }

  const state = await evolutionConnectionState(instanceName);
  const connectionState = state.ok
    ? normalizeEvolutionConnectionState(parseEvolutionConnectionStatePayload(state.data), "close")
    : "unknown";

  return {
    ready: state.ok && connectionState === "open",
    instanceName,
    connectionState,
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
  status: "sent" | "failed" | "delivery_failed";
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

export async function markSystemNotificationDeliveryFailed(params: {
  evolutionMessageId: string;
  reason: string;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const { data: rows } = await sb
      .from("system_notifications_log")
      .select("id, metadata")
      .eq("status", "sent")
      .filter("metadata->>evolution_message_id", "eq", params.evolutionMessageId)
      .limit(1);

    const row = rows?.[0];
    if (!row) return;

    const meta =
      row.metadata && typeof row.metadata === "object"
        ? { ...(row.metadata as Record<string, unknown>) }
        : {};

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
    console.warn("[system-agent] delivery_failed_update", {
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

  // Valida existência no WhatsApp e envia no formato que a Evolution reconheceu para o contato.
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

  let send: Awaited<ReturnType<typeof sendEvolutionTextWithRestartRetry>> | null = null;
  let sendNumber = candidateNumbers[0] ?? platformNumber;
  const tried: string[] = [];

  for (const candidate of candidateNumbers) {
    tried.push(candidate);
    const attempt = await sendEvolutionTextWithRestartRetry({
      instanceName: resolvedInstance,
      number: candidate,
      text: message.slice(0, 4000),
    });
    send = attempt;
    sendNumber = candidate;
    const attemptFailure = attempt.ok ? detectEvolutionPayloadFailure(attempt.data) : null;
    if (attempt.ok && !attemptFailure) break;
    if (!attempt.ok && !isEvolutionConnectionClosedError(attempt.error)) {
      // HTTP error unrelated to session — try next number format before giving up.
      continue;
    }
    if (attemptFailure && !isEvolutionConnectionClosedError(attemptFailure)) {
      continue;
    }
    break;
  }

  if (!send) {
    return { ok: false, error: "evolution_send_failed" };
  }

  const payloadFailure = send.ok ? detectEvolutionPayloadFailure(send.data) : null;
  const evolutionMessageId = send.ok ? extractEvolutionMessageId(send.data) : null;
  const evolutionResponseStatus =
    send.ok && send.data && typeof send.data === "object"
      ? (send.data as Record<string, unknown>).status
      : null;
  const missingMessageId = send.ok && !payloadFailure && !evolutionMessageId;
  const finalOk = send.ok && !payloadFailure && !missingMessageId;
  const finalError = send.ok
    ? payloadFailure ?? (missingMessageId ? "missing_evolution_message_id" : null)
    : send.error;

  await logSystemNotification({
    type: options?.type ?? "generic",
    toNumber: platformNumber,
    message,
    status: finalOk ? "sent" : "failed",
    error: finalOk ? null : finalError,
    metadata: {
      ...(options?.metadata ?? {}),
      instance_name: resolvedInstance,
      number_raw: rawDigits,
      number_normalized: platformNumber,
      number_sent: sendNumber,
      numbers_tried: tried,
      resolved_jid: resolvedJid,
      evolution_number_check: numberCheck,
      evolution_connection_state: liveState,
      evolution_message_id: evolutionMessageId,
      evolution_response_status: evolutionResponseStatus,
      evolution_session_restarted: send.restarted === true,
    },
  });

  const debug = {
    numberSent: sendNumber,
    candidatesTried: tried,
    evolutionMessageId,
    evolutionResponseStatus,
    sessionRestarted: send.restarted === true,
  };

  if (!finalOk) return { ok: false, error: finalError ?? "evolution_send_failed", debug };
  return { ok: true, debug };
}
