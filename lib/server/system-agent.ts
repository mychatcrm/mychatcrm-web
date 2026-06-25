import {
  evolutionConnectionState,
  evolutionSendText,
  normalizeEvolutionConnectionState,
  parseEvolutionConnectionStatePayload,
} from "@/lib/integrations/evolution-api";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";

export const SYSTEM_AGENT_ID = "mychatcrm-system-agent";
export const SYSTEM_TENANT_ID = "tenant-system-internal";

export async function getSystemAgentInstanceName(): Promise<string | null> {
  const row = await getEvolutionInstanceByTenantId(SYSTEM_TENANT_ID);
  return row?.instance_name?.trim() || null;
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
  status: "sent" | "failed";
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

  return null;
}

export async function sendSystemNotification(
  toNumber: string,
  message: string,
  instanceName: string,
  options?: {
    type?: string;
    metadata?: Record<string, unknown> | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const rawDigits = toNumber.replace(/\D/g, "");
  const digits = normalizeBrazilianPhoneNumber(rawDigits);

  console.log("[HANDOFF_DEBUG] sendSystemNotification", {
    toNumber_raw: toNumber,
    digits_before_normalize: rawDigits,
    digits_after_normalize: digits,
    instanceName_received: instanceName,
    type: options?.type ?? "generic",
  });

  if (!isValidBrazilianWhatsAppNumber(digits)) {
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits || toNumber,
      message,
      status: "failed",
      error: "invalid_number",
      metadata: options?.metadata ?? null,
    });
    console.log("[HANDOFF_DEBUG] invalid_number — abortando");
    return { ok: false, error: "invalid_number" };
  }

  const resolvedInstance = instanceName.trim() || (await getSystemAgentInstanceName());
  console.log("[HANDOFF_DEBUG] instance resolved", {
    instanceName_trim: instanceName.trim(),
    resolvedInstance: resolvedInstance ?? "(null)",
  });

  if (!resolvedInstance) {
    await logSystemNotification({
      type: options?.type ?? "generic",
      toNumber: digits,
      message,
      status: "failed",
      error: "missing_system_instance",
      metadata: options?.metadata ?? null,
    });
    console.log("[HANDOFF_DEBUG] missing_system_instance — abortando");
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
    console.log("[HANDOFF_DEBUG] system_instance_not_open — abortando", {
      instanceName: resolvedInstance,
      liveState,
      error,
    });
    return { ok: false, error };
  }

  console.log("[HANDOFF_DEBUG] chamando evolutionSendText", {
    instanceName: resolvedInstance,
    number: digits,
    messageLength: message.length,
  });

  const send = await evolutionSendText({
    instanceName: resolvedInstance,
    number: digits,
    text: message.slice(0, 4000),
  });

  const payloadFailure = send.ok ? detectEvolutionPayloadFailure(send.data) : null;
  const evolutionMessageId = send.ok ? extractEvolutionMessageId(send.data) : null;
  const finalOk = send.ok && !payloadFailure;
  const finalError = send.ok ? payloadFailure : send.error;

  console.log("[HANDOFF_DEBUG] evolutionSendText resultado", {
    ok: finalOk,
    error: finalError,
    evolutionMessageId,
  });

  await logSystemNotification({
    type: options?.type ?? "generic",
    toNumber: digits,
    message,
    status: finalOk ? "sent" : "failed",
    error: finalOk ? null : finalError,
    metadata: {
      ...(options?.metadata ?? {}),
      instance_name: resolvedInstance,
      number_raw: rawDigits,
      number_normalized: digits,
      evolution_connection_state: liveState,
      evolution_message_id: evolutionMessageId,
    },
  });

  if (!finalOk) return { ok: false, error: finalError ?? "evolution_send_failed" };
  return { ok: true };
}
