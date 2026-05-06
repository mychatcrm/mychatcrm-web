import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AdminIaAuditAction =
  | "openai_credentials_patch"
  | "openai_credentials_delete"
  | "openai_test_connection";

/**
 * Auditoria best-effort: se a migração `admin_ia_audit_log` não existir, falha silenciosa (só log).
 */
export async function logAdminIaAudit(params: {
  adminId: string;
  action: AdminIaAuditAction;
  detail: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.from("admin_ia_audit_log").insert({
      admin_id: params.adminId,
      action: params.action,
      detail: params.detail,
    });
    if (error) {
      console.warn("[admin-ia-audit] insert skipped:", error.message);
    }
  } catch (e) {
    console.warn("[admin-ia-audit]", e instanceof Error ? e.message : e);
  }
}
