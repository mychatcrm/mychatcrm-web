import { evolutionSendText } from "@/lib/integrations/evolution-api";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";

export const SYSTEM_AGENT_ID = "mychatcrm-system-agent";
export const SYSTEM_TENANT_ID = "tenant-system-internal";

export async function getSystemAgentInstanceName(): Promise<string | null> {
  const row = await getEvolutionInstanceByTenantId(SYSTEM_TENANT_ID);
  return row?.instance_name?.trim() || null;
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
  const digits = toNumber.replace(/\D/g, "");
  if (digits.length < 10) {
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

  const send = await evolutionSendText({
    instanceName: resolvedInstance,
    number: digits,
    text: message.slice(0, 4000),
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
    },
  });

  if (!send.ok) return { ok: false, error: send.error };
  return { ok: true };
}
