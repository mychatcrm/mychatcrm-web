import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AtomicAgentSaveInput = {
  tenantId: string;
  agentId: string;
  createOnly: boolean;
  expectedVersion: number | null;
  displayName: string;
  systemPrompt: string;
  active: boolean;
  metadata: Record<string, unknown>;
  voiceId: string | null;
  responseMode: string;
  crmAutoMoveEnabled: boolean;
  crmTargetFunnelId: string | null;
  crmTargetColumnId: string | null;
  crmTargetStatus: string | null;
  reviewStatus: "ready" | "action_required";
  reviewReasons: string[];
  replaceConnectors: boolean;
  connectorIds: string[];
};

export type AtomicAgentMutationResult =
  | { ok: true; row?: Record<string, unknown>; configVersion?: number }
  | { ok: false; code: string; dependencies?: Record<string, unknown> };

function resultObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function saveTenantAgentAtomic(
  sb: ServiceClient,
  input: AtomicAgentSaveInput,
): Promise<AtomicAgentMutationResult> {
  const { data, error } = await sb.rpc("save_tenant_agent_v2", {
    p_tenant_id: input.tenantId,
    p_agent_id: input.agentId,
    p_create_only: input.createOnly,
    p_expected_version: input.expectedVersion,
    p_display_name: input.displayName,
    p_system_prompt: input.systemPrompt,
    p_active: input.active,
    p_metadata: input.metadata,
    p_voice_id: input.voiceId,
    p_response_mode: input.responseMode,
    p_crm_auto_move_enabled: input.crmAutoMoveEnabled,
    p_crm_target_funnel_id: input.crmTargetFunnelId,
    p_crm_target_column_id: input.crmTargetColumnId,
    p_crm_target_status: input.crmTargetStatus,
    p_review_status: input.reviewStatus,
    p_review_reasons: input.reviewReasons,
    p_replace_connectors: input.replaceConnectors,
    p_connector_ids: input.connectorIds,
  });
  if (error) throw new Error(error.message);
  const result = resultObject(data);
  if (result.ok !== true) {
    return {
      ok: false,
      code: typeof result.code === "string" ? result.code : "agent_save_blocked",
      dependencies: resultObject(result.dependencies),
    };
  }
  return {
    ok: true,
    row: resultObject(result.row),
    configVersion: Number(result.configVersion ?? 0) || undefined,
  };
}

export async function archiveTenantAgentAtomic(params: {
  sb: ServiceClient;
  tenantId: string;
  agentId: string;
  expectedVersion: number;
  archivedBy?: string | null;
}): Promise<AtomicAgentMutationResult> {
  const { data, error } = await params.sb.rpc("archive_tenant_agent_v1", {
    p_tenant_id: params.tenantId,
    p_agent_id: params.agentId,
    p_expected_version: params.expectedVersion,
    p_archived_by: params.archivedBy ?? null,
  });
  if (error) throw new Error(error.message);
  const result = resultObject(data);
  if (result.ok !== true) {
    return {
      ok: false,
      code: typeof result.code === "string" ? result.code : "agent_archive_blocked",
      dependencies: resultObject(result.dependencies),
    };
  }
  return { ok: true };
}
