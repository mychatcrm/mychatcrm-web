import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ExternalApiConnectorAuditAction =
  | "connector_created"
  | "connector_updated"
  | "connector_deleted"
  | "credential_rotated"
  | "sync_completed"
  | "sync_failed";

/**
 * Auditoria de mudança de CONFIGURAÇÃO do conector — distinto do log de
 * CHAMADA (`external_api_call_logs`). Best-effort, no molde de
 * `logAdminIaAudit` (lib/server/admin-ia-audit.ts): nunca derruba a operação
 * principal se o insert falhar.
 */
export async function logExternalApiConnectorAudit(params: {
  tenantId: string;
  connectorId: string | null;
  actorId?: string | null;
  action: ExternalApiConnectorAuditAction;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const { error } = await sb.from("external_api_connector_audit_log").insert({
      tenant_id: params.tenantId,
      connector_id: params.connectorId,
      actor_id: params.actorId ?? null,
      action: params.action,
      detail: params.detail ?? {},
    });
    if (error) console.warn("[external-api-connector-audit] insert_skipped", error.message);
  } catch (e) {
    console.warn("[external-api-connector-audit]", e instanceof Error ? e.message : e);
  }
}
