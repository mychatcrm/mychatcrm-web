import { DEFAULT_CRM_FUNNELS } from "@/lib/crm-funnels";
import { deleteCrmLeadsForTenant, normalizeCrmLeadIds, validateCrmLeadIds } from "@/lib/server/crm-leads-delete";
import {
  normalizeAllowedStatusIds,
  validateLeadFunnelIdForUpdate,
  validateLeadStatusForUpdate,
} from "@/lib/server/crm-lead-status-validation";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { leadInScope, type AccessScope, type ScopableLead } from "@/lib/server/access-scope";
import type { TeamEmployee } from "@/lib/team-employees-types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type CrmBulkAction =
  | "assign_attendant"
  | "change_status"
  | "convert_to_active_offer"
  | "delete";

export type CrmBulkActionResult = {
  action: CrmBulkAction;
  requestedCount: number;
  affectedCount: number;
  deletedIds?: string[];
  offer?: {
    id: string;
    title: string;
    status: string;
    createdAt: string | null;
    leadCount: number;
  };
};

const MAX_BULK_ACTION_LEADS = 100;

function maskTenantId(tenantId: string): string {
  if (tenantId.length <= 8) return tenantId;
  return `${tenantId.slice(0, 6)}...${tenantId.slice(-4)}`;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean : null;
}

function validateCommonIds(ids: string[]): string | null {
  const error = validateCrmLeadIds(ids);
  if (error) return error;
  if (ids.length > MAX_BULK_ACTION_LEADS) return `Aplique ações em no máximo ${MAX_BULK_ACTION_LEADS} leads por vez.`;
  return null;
}

function logCrmBulkAction(params: {
  tenantId: string;
  action: CrmBulkAction;
  requestedCount: number;
  affectedCount: number;
  result: "success" | "skipped" | "error";
  reason?: string;
}) {
  const payload: Record<string, string | number> = {
    tenant_id: maskTenantId(params.tenantId),
    action: params.action,
    requested_count: params.requestedCount,
    affected_count: params.affectedCount,
    result: params.result,
  };
  if (params.reason) payload.reason = params.reason;
  if (params.result === "error") console.warn("[crm-leads-bulk-action]", payload);
  else console.info("[crm-leads-bulk-action]", payload);
}

async function getTenantLeadIds(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  ids: string[];
}): Promise<string[]> {
  const { data, error } = await params.sb
    .from("leads")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .in("id", params.ids);

  if (error) throw new Error("Erro ao validar leads do tenant.");
  return (data ?? [])
    .map((row) => (row && typeof row === "object" ? (row as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string");
}

async function requireAllTenantLeads(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  ids: string[];
}): Promise<string[]> {
  const tenantLeadIds = await getTenantLeadIds(params);
  if (tenantLeadIds.length !== params.ids.length) {
    throw new Error("Alguns leads não pertencem ao tenant atual ou não existem.");
  }
  return tenantLeadIds;
}

/**
 * Pertencer ao tenant não basta: a ação em lote alcança até 100 leads de uma
 * vez, então cada id precisa estar dentro do escopo de quem está agindo.
 * Falha o lote inteiro se um só id estiver fora — nunca aplica parcialmente.
 */
async function requireAllLeadsInScope(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  ids: string[];
  scope: AccessScope;
}): Promise<void> {
  if (params.scope.kind === "all") return;

  const { data, error } = await params.sb
    .from("leads")
    .select("id, team_id, owner_employee_id")
    .eq("tenant_id", params.tenantId)
    .in("id", params.ids);

  if (error) throw new Error("Não foi possível validar o acesso aos leads selecionados.");

  const rows = (data ?? []) as Array<ScopableLead & { id: string }>;
  const allowed = new Set(rows.filter((row) => leadInScope(row, params.scope)).map((row) => row.id));
  if (allowed.size !== params.ids.length) {
    throw new Error("Alguns leads selecionados não estão sob a sua responsabilidade.");
  }
}

export function validateCrmBulkStatus(params: {
  status: unknown;
  allowedStatusIds?: unknown;
}): { status: string; allowed: string[] } {
  const status = textOrNull(params.status);
  if (!status) throw new Error("Selecione um status válido.");

  const explicitAllowed = normalizeAllowedStatusIds(params.allowedStatusIds);
  const fallbackAllowed = DEFAULT_CRM_FUNNELS.flatMap((funnel) => funnel.columns.map((column) => column.id));
  const allowed = explicitAllowed.length ? explicitAllowed : fallbackAllowed;

  if (explicitAllowed.length) {
    if (!explicitAllowed.includes(status)) {
      throw new Error("Status inválido para o funil selecionado.");
    }
  } else {
    const statusError = validateLeadStatusForUpdate(status);
    if (statusError || !allowed.includes(status)) {
      throw new Error("Status inválido para o funil selecionado.");
    }
  }

  return { status, allowed };
}

export async function executeCrmLeadBulkAction(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  actorEmail?: string | null;
  action: CrmBulkAction;
  leadIds: unknown;
  payload?: Record<string, unknown>;
  teamEmployees?: TeamEmployee[];
  /** Recorte de quem está agindo. Ausente = chamada interna sem sessão. */
  scope?: AccessScope;
}): Promise<CrmBulkActionResult> {
  const ids = normalizeCrmLeadIds(params.leadIds);
  const validationError = validateCommonIds(ids);
  if (validationError) {
    logCrmBulkAction({
      tenantId: params.tenantId,
      action: params.action,
      requestedCount: ids.length,
      affectedCount: 0,
      result: "skipped",
      reason: validationError,
    });
    throw new Error(validationError);
  }

  await requireAllTenantLeads({ sb: params.sb, tenantId: params.tenantId, ids });
  if (params.scope) {
    await requireAllLeadsInScope({
      sb: params.sb,
      tenantId: params.tenantId,
      ids,
      scope: params.scope,
    });
  }
  const now = new Date().toISOString();
  const payload = params.payload ?? {};

  try {
    if (params.action === "delete") {
      const result = await deleteCrmLeadsForTenant({ sb: params.sb, tenantId: params.tenantId, ids });
      return {
        action: params.action,
        requestedCount: ids.length,
        affectedCount: result.deletedCount,
        deletedIds: result.deletedIds,
      };
    }

    if (params.action === "assign_attendant") {
      const employeeId = textOrNull(payload.employeeId);
      if (!employeeId) throw new Error("Selecione um atendente.");
      const employees = params.teamEmployees ?? [];
      const employee = employees.find((item) => item.id === employeeId && item.ativo && !item.accountSuspended);
      if (!employee) throw new Error("Atendente inválido para este tenant.");

      const { data, error } = await params.sb
        .from("leads")
        .update({ owner_employee_id: employee.id, updated_at: now })
        .eq("tenant_id", params.tenantId)
        .in("id", ids)
        .select("id");

      if (error) throw new Error("Erro ao atribuir atendente.");
      const affectedCount = data?.length ?? 0;
      logCrmBulkAction({ tenantId: params.tenantId, action: params.action, requestedCount: ids.length, affectedCount, result: "success" });
      return { action: params.action, requestedCount: ids.length, affectedCount };
    }

    if (params.action === "change_status") {
      const { status } = validateCrmBulkStatus({
        status: payload.status,
        allowedStatusIds: payload.allowedStatusIds,
      });
      const funnelId = textOrNull(payload.funnelId);
      if (funnelId) {
        const funnelError = validateLeadFunnelIdForUpdate(funnelId);
        if (funnelError) throw new Error(funnelError);
      }
      const patch: Record<string, unknown> = { status, updated_at: now };
      if (funnelId) patch.crm_funnel_id = funnelId;

      const { data, error } = await params.sb
        .from("leads")
        .update(patch)
        .eq("tenant_id", params.tenantId)
        .in("id", ids)
        .select("id");

      if (error) throw new Error("Erro ao alterar status dos leads.");
      const affectedCount = data?.length ?? 0;
      logCrmBulkAction({ tenantId: params.tenantId, action: params.action, requestedCount: ids.length, affectedCount, result: "success" });
      return { action: params.action, requestedCount: ids.length, affectedCount };
    }

    const title = textOrNull(payload.title) ?? "Oferta ativa";
    const { data: offer, error: offerError } = await params.sb
      .from("active_offers")
      .insert({
        tenant_id: params.tenantId,
        title,
        status: "active",
        created_by: params.actorEmail ?? null,
        updated_at: now,
      })
      .select("id, title, status, created_at")
      .single();

    if (offerError || !offer) throw new Error("Erro ao criar oferta ativa.");

    const offerId = (offer as { id: string }).id;
    const rows = ids.map((leadId) => ({
      tenant_id: params.tenantId,
      active_offer_id: offerId,
      lead_id: leadId,
    }));
    const { data: links, error: linksError } = await params.sb
      .from("active_offer_leads")
      .upsert(rows, { onConflict: "active_offer_id,lead_id", ignoreDuplicates: true })
      .select("lead_id");

    if (linksError) throw new Error("Erro ao vincular leads à oferta ativa.");
    const linkedCount = links?.length ?? ids.length;
    logCrmBulkAction({ tenantId: params.tenantId, action: params.action, requestedCount: ids.length, affectedCount: linkedCount, result: "success" });
    return {
      action: params.action,
      requestedCount: ids.length,
      affectedCount: linkedCount,
      offer: {
        id: offerId,
        title: String((offer as { title?: unknown }).title ?? title),
        status: String((offer as { status?: unknown }).status ?? "active"),
        createdAt: typeof (offer as { created_at?: unknown }).created_at === "string" ? (offer as { created_at: string }).created_at : null,
        leadCount: linkedCount,
      },
    };
  } catch (error) {
    logCrmBulkAction({
      tenantId: params.tenantId,
      action: params.action,
      requestedCount: ids.length,
      affectedCount: 0,
      result: "error",
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    throw error;
  }
}
