import { evolutionSendText } from "@/lib/integrations/evolution-api";
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

  if (digits.length < 10) {
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

  console.log("[HANDOFF_DEBUG] evolutionSendText resultado", {
    ok: send.ok,
    error: send.ok ? null : send.error,
  });

  await logSystemNotification({
    type: options?.type ?? "generic",
    toNumber: digits,
    message,
    status: send.ok ? "sent" : "failed",
    error: send.ok ? null : send.error,
    metadata: {
      ...(options?.metadata ?? {}),
      instance_name: resolvedInstance,
      number_raw: rawDigits,
      number_normalized: digits,
    },
  });

  if (!send.ok) return { ok: false, error: send.error };
  return { ok: true };
}
