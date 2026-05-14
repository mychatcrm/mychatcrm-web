import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { deleteLeadCompletely } from "@/lib/server/delete-lead-completely";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type DeleteCrmLeadsResult = {
  requestedIds: string[];
  deletedIds: string[];
  requestedCount: number;
  deletedCount: number;
  report?: Awaited<ReturnType<typeof deleteLeadCompletely>>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCrmLeadIds(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (!clean) continue;
    seen.add(clean);
  }
  return [...seen];
}

export function validateCrmLeadIds(ids: string[]): string | null {
  if (!ids.length) return "Informe ao menos um lead para apagar.";
  if (ids.length > 100) return "Apague no máximo 100 leads por vez.";
  if (ids.some((id) => !UUID_RE.test(id))) return "Lista de leads inválida.";
  return null;
}

function maskTenantId(tenantId: string): string {
  if (tenantId.length <= 8) return tenantId;
  return `${tenantId.slice(0, 6)}...${tenantId.slice(-4)}`;
}

export function logCrmLeadDelete(params: {
  tenantId: string;
  requestedCount: number;
  deletedCount: number;
  action: "deleted" | "error" | "skipped";
  reason?: string;
  code?: string | null;
}) {
  const payload: Record<string, string | number> = {
    tenant_id: maskTenantId(params.tenantId),
    requested_count: params.requestedCount,
    deleted_count: params.deletedCount,
    action: params.action,
  };
  if (params.reason) payload.reason = params.reason;
  if (params.code) payload.code = params.code;
  if (params.action === "error") console.warn("[crm-leads-delete]", payload);
  else console.info("[crm-leads-delete]", payload);
}

export async function deleteCrmLeadsForTenant(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  ids: string[];
}): Promise<DeleteCrmLeadsResult> {
  const requestedIds = normalizeCrmLeadIds(params.ids);
  const validationError = validateCrmLeadIds(requestedIds);
  if (validationError) {
    logCrmLeadDelete({
      tenantId: params.tenantId,
      requestedCount: requestedIds.length,
      deletedCount: 0,
      action: "skipped",
      reason: validationError,
    });
    throw new Error(validationError);
  }

  const report = await deleteLeadCompletely({
    sb: params.sb,
    tenantId: params.tenantId,
    leadIds: requestedIds,
  });

  const deletedIds = report.leadIds;

  logCrmLeadDelete({
    tenantId: params.tenantId,
    requestedCount: requestedIds.length,
    deletedCount: deletedIds.length,
    action: "deleted",
  });

  return {
    requestedIds,
    deletedIds,
    requestedCount: requestedIds.length,
    deletedCount: deletedIds.length,
    report,
  };
}
