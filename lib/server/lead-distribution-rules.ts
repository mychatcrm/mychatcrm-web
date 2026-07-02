import type {
  LeadDistributionRule,
  LeadDistributionType,
  LeadFieldMapping,
  LeadRuleSource,
} from "@/lib/lead-distribution-rules";

export const VALID_LEAD_RULE_SOURCES = ["meta_form", "whatsapp_api", "whatsapp_qr", "whatsapp_organico", "other"] as const;
export const VALID_LEAD_DISTRIBUTION_TYPES = [
  "round_robin",
  "specific_agents",
  "automation_agent",
  "all_agents",
  "specific_employees",
  "round_robin_employees",
  "all_employees",
  "entry_owner",
] as const;

export type LeadDistributionRuleRow = {
  id: string;
  tenant_id: string;
  name: string;
  source: LeadRuleSource;
  order_index: number;
  active: boolean;
  transport: "evolution" | "cloud_api" | null;
  connection_id: string | null;
  conflict_policy: LeadDistributionRule["conflictPolicy"] | null;
  conflict_inactivity_minutes: number | null;
  redistribution: boolean;
  distribution_type: LeadDistributionType;
  agent_ids: unknown;
  employee_ids: unknown;
  mappings: unknown;
  page_label: string | null;
  page_id: string | null;
  use_all_forms: boolean | null;
  excluded_form_ids: unknown;
  included_form_ids: unknown;
  conversion_send_enabled: boolean | null;
  conversion_pixel_id: string | null;
  conversion_api_secret: string | null;
  redistribution_config: unknown;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function mappingsArray(value: unknown): LeadFieldMapping[] {
  return Array.isArray(value) ? (value as LeadFieldMapping[]) : [];
}

function formatDateLabel(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString("pt-BR");
  return date.toLocaleDateString("pt-BR");
}

export function isValidLeadRuleSource(value: unknown): value is LeadRuleSource {
  return typeof value === "string" && VALID_LEAD_RULE_SOURCES.includes(value as LeadRuleSource);
}

export function isValidLeadDistributionType(value: unknown): value is LeadDistributionType {
  return typeof value === "string" && VALID_LEAD_DISTRIBUTION_TYPES.includes(value as LeadDistributionType);
}

export function leadRuleRowToClient(row: LeadDistributionRuleRow): LeadDistributionRule {
  return {
    id: row.id,
    name: row.name,
    order: row.order_index,
    source: row.source,
    active: row.active,
    transport: row.transport ?? undefined,
    connectionId: row.connection_id,
    conflictPolicy: row.conflict_policy ?? "latest_wins",
    conflictInactivityMinutes: row.conflict_inactivity_minutes ?? 1440,
    redistribution: row.redistribution,
    distributionType: row.distribution_type,
    agentIds: stringArray(row.agent_ids),
    employeeIds: stringArray(row.employee_ids),
    mappings: mappingsArray(row.mappings),
    pageLabel: row.page_label ?? undefined,
    pageId: row.page_id ?? undefined,
    useAllForms: row.use_all_forms ?? true,
    excludedFormIds: stringArray(row.excluded_form_ids),
    includedFormIds: stringArray(row.included_form_ids),
    conversionSendEnabled: row.conversion_send_enabled ?? false,
    conversionPixelId: row.conversion_pixel_id ?? "",
    conversionApiSecret: row.conversion_api_secret ?? "",
    redistributionConfig:
      row.redistribution_config && typeof row.redistribution_config === "object"
        ? (row.redistribution_config as LeadDistributionRule["redistributionConfig"])
        : undefined,
    createdBy: row.created_by ?? "Sistema",
    createdAtLabel: formatDateLabel(row.created_at),
  };
}

export function leadRuleClientToDbPayload(
  body: Record<string, unknown>,
  tenantId: string,
  fallbackOrder = 999,
): Record<string, unknown> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const source = body.source;
  const distributionType = body.distributionType ?? body.distribution_type;

  if (!name) throw new Error("name is required");
  if (!isValidLeadRuleSource(source)) throw new Error("source is invalid");
  if (!isValidLeadDistributionType(distributionType)) throw new Error("distribution_type is invalid");

  const useAllForms = body.useAllForms ?? body.use_all_forms;
  const redistributionConfig = body.redistributionConfig ?? body.redistribution_config ?? {};
  const conflictPolicy = body.conflictPolicy ?? body.conflict_policy;
  const allowedConflictPolicies = new Set([
    "latest_wins",
    "priority_wins",
    "keep_until_inactive",
    "manual_review",
  ]);

  return {
    tenant_id: tenantId,
    name,
    source,
    order_index: typeof body.order === "number" ? body.order : typeof body.order_index === "number" ? body.order_index : fallbackOrder,
    active: typeof body.active === "boolean" ? body.active : true,
    transport:
      body.transport === "cloud_api" || body.transport === "evolution"
        ? body.transport
        : source === "whatsapp_api"
          ? "cloud_api"
          : source === "whatsapp_qr"
            ? "evolution"
            : null,
    connection_id:
      typeof (body.connectionId ?? body.connection_id) === "string"
        ? String(body.connectionId ?? body.connection_id).trim() || null
        : null,
    conflict_policy:
      typeof conflictPolicy === "string" && allowedConflictPolicies.has(conflictPolicy)
        ? conflictPolicy
        : "latest_wins",
    conflict_inactivity_minutes:
      typeof (body.conflictInactivityMinutes ?? body.conflict_inactivity_minutes) === "number"
        ? Math.max(
            1,
            Math.min(
              525600,
              Math.floor(
                Number(body.conflictInactivityMinutes ?? body.conflict_inactivity_minutes),
              ),
            ),
          )
        : 1440,
    redistribution: typeof body.redistribution === "boolean" ? body.redistribution : false,
    distribution_type: distributionType,
    agent_ids: stringArray(body.agentIds ?? body.agent_ids),
    employee_ids: stringArray(body.employeeIds ?? body.employee_ids),
    mappings: Array.isArray(body.mappings) ? body.mappings : [],
    page_label: typeof body.pageLabel === "string" ? body.pageLabel.trim() || null : typeof body.page_label === "string" ? body.page_label.trim() || null : null,
    page_id: typeof body.pageId === "string" ? body.pageId.trim() || null : typeof body.page_id === "string" ? body.page_id.trim() || null : null,
    use_all_forms: typeof useAllForms === "boolean" ? useAllForms : true,
    excluded_form_ids: stringArray(body.excludedFormIds ?? body.excluded_form_ids),
    included_form_ids: stringArray(body.includedFormIds ?? body.included_form_ids),
    conversion_send_enabled:
      typeof body.conversionSendEnabled === "boolean"
        ? body.conversionSendEnabled
        : typeof body.conversion_send_enabled === "boolean"
          ? body.conversion_send_enabled
          : false,
    conversion_pixel_id:
      typeof body.conversionPixelId === "string"
        ? body.conversionPixelId.trim() || null
        : typeof body.conversion_pixel_id === "string"
          ? body.conversion_pixel_id.trim() || null
          : null,
    conversion_api_secret:
      typeof body.conversionApiSecret === "string"
        ? body.conversionApiSecret
        : typeof body.conversion_api_secret === "string"
          ? body.conversion_api_secret
          : null,
    redistribution_config:
      redistributionConfig && typeof redistributionConfig === "object" && !Array.isArray(redistributionConfig)
        ? redistributionConfig
        : {},
    created_by: typeof body.createdBy === "string" ? body.createdBy : typeof body.created_by === "string" ? body.created_by : null,
    updated_at: new Date().toISOString(),
  };
}
