import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const AGENT_RUNTIME_SUBSYSTEMS = [
  "agenda",
  "agenda_reminder",
  "follow_up",
] as const;

export type AgentRuntimeSubsystem = (typeof AGENT_RUNTIME_SUBSYSTEMS)[number];
export type AgentRuntimeSubsystemMode = "enabled" | "shadow" | "disabled";

export type AgentRuntimeSubsystemControl = {
  subsystem: AgentRuntimeSubsystem;
  mode: AgentRuntimeSubsystemMode;
  enabled: boolean;
  updatedAt: string | null;
};

function firstRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : null;
}

/**
 * Reads the tenant-scoped emergency control from a service-role-only RPC.
 *
 * A database error fails closed. A missing row is normalized by the RPC to
 * `enabled` so rollout remains backwards compatible after the migration.
 */
export async function getAgentRuntimeSubsystemControl(params: {
  tenantId: string;
  subsystem: AgentRuntimeSubsystem;
  sb?: SupabaseServiceClient;
}): Promise<AgentRuntimeSubsystemControl> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb.rpc(
    "get_agent_runtime_subsystem_control_v1",
    {
      p_tenant_id: params.tenantId,
      p_subsystem: params.subsystem,
    },
  );
  if (error) {
    return {
      subsystem: params.subsystem,
      mode: "disabled",
      enabled: false,
      updatedAt: null,
    };
  }
  const row = firstRecord(data);
  const mode =
    row?.mode === "enabled" || row?.mode === "shadow"
      ? row.mode
      : "disabled";
  return {
    subsystem: params.subsystem,
    mode,
    enabled: row?.enabled === true && mode !== "disabled",
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}
