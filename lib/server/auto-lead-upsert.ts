import { DEFAULT_CRM_FUNNELS } from "@/lib/crm-funnels";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type LeadRow = Record<string, unknown>;
type WhatsAppLeadDirection = "inbound" | "outbound";
type AutoLeadLogAction = "created" | "updated" | "skipped" | "conflict_updated" | "error";
type CrmMoveAction = "enabled" | "disabled" | "skipped";
type AgentCrmMoveTarget = {
  enabled: boolean;
  funnelId: string | null;
  columnId: string | null;
  reason?: string;
};

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const DUPLICATE_KEY_CODES = new Set(["23505"]);
const MIN_WHATSAPP_PHONE_DIGITS = 8;

function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code));
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes(column.toLowerCase());
}

function logAutoLeadUpsert(params: {
  tenantId: string;
  phone?: string | null;
  action: AutoLeadLogAction;
  reason?: string;
  direction?: WhatsAppLeadDirection;
  code?: string | null;
  agentId?: string | null;
  crmMove?: CrmMoveAction;
  targetFunnel?: string | null;
  targetColumn?: string | null;
}): void {
  const payload: Record<string, string> = {
    tenant_id: params.tenantId,
    phone_last4: params.phone ? params.phone.slice(-4) : "none",
    action: params.action,
  };
  if (params.reason) payload.reason = params.reason;
  if (params.direction) payload.direction = params.direction;
  if (params.code) payload.code = params.code;
  if (params.agentId) payload.agent_id = params.agentId;
  if (params.crmMove) payload.crm_move = params.crmMove;
  if (params.targetFunnel) payload.target_funnel = params.targetFunnel;
  if (params.targetColumn) payload.target_column = params.targetColumn;

  if (params.action === "error") {
    console.warn("[auto-lead-upsert]", payload);
    return;
  }

  console.info("[auto-lead-upsert]", payload);
}

export function phoneFromRemoteJid(remoteJid: string): string {
  return normalizeWhatsAppPhone(remoteJid);
}

export function normalizeWhatsAppPhone(value: string | null | undefined): string {
  return (value ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
}

function isGroupRemoteJid(value: string | null | undefined): boolean {
  return Boolean(value?.includes("@g.us"));
}

function isValidWhatsAppContact(params: {
  remoteJid?: string | null;
  phone?: string | null;
  normalizedPhone: string;
}): boolean {
  if (isGroupRemoteJid(params.remoteJid)) return false;
  return params.normalizedPhone.length >= MIN_WHATSAPP_PHONE_DIGITS;
}

function invalidContactReason(params: {
  tenantId: string;
  remoteJid?: string | null;
  normalizedPhone: string;
}): string | null {
  if (!params.tenantId.trim()) return "missing_tenant_id";
  if (isGroupRemoteJid(params.remoteJid)) return "group_remote_jid";
  if (!params.normalizedPhone) return "empty_phone";
  if (params.normalizedPhone.length < MIN_WHATSAPP_PHONE_DIGITS) return "short_phone";
  return null;
}

function firstDefaultKanbanStatus(): string {
  return DEFAULT_CRM_FUNNELS[0]?.columns[0]?.id ?? "novo";
}

async function resolveFirstKanbanStatus(
  sb: SupabaseServiceClient,
  tenantId: string,
): Promise<string> {
  const fallback = firstDefaultKanbanStatus();

  const { data: funnelRows, error: funnelError } = await sb
    .from("crm_funnels")
    .select("columns")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (!funnelError) {
    const columns = (funnelRows?.[0] as { columns?: unknown } | undefined)?.columns;
    if (Array.isArray(columns)) {
      const first = columns.find((column) => column && typeof column === "object") as
        | { id?: unknown; status?: unknown; column_id?: unknown }
        | undefined;
      const value = first?.id ?? first?.status ?? first?.column_id;
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  const { data: columnRows, error: columnError } = await sb
    .from("kanban_columns")
    .select("id,status,column_id,key")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .limit(1);

  if (!columnError) {
    const first = columnRows?.[0] as
      | { id?: unknown; status?: unknown; column_id?: unknown; key?: unknown }
      | undefined;
    const value = first?.status ?? first?.column_id ?? first?.key ?? first?.id;
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return fallback;
}

function textOrNull(value: string | null | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

function unknownTextOrNull(value: unknown): string | null {
  return typeof value === "string" ? textOrNull(value) : null;
}

function unknownBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : value === "true";
}

async function resolveAgentCrmMoveTarget(
  sb: SupabaseServiceClient,
  params: { tenantId: string; agentId?: string | null },
): Promise<AgentCrmMoveTarget> {
  const agentId = textOrNull(params.agentId);
  if (!agentId || agentId === "human") return { enabled: false, funnelId: null, columnId: null, reason: "no_agent_config" };

  const initial = await sb
    .from("tenant_agents")
    .select("metadata, crm_auto_move_enabled, crm_target_funnel_id, crm_target_column_id, crm_target_status")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", agentId)
    .limit(1)
    .maybeSingle();
  let data: unknown = initial.data;
  let error = initial.error;

  if (isMissingColumnError(error, "crm_auto_move_enabled")) {
    const fallback = await sb
      .from("tenant_agents")
      .select("metadata")
      .eq("tenant_id", params.tenantId)
      .eq("agent_id", agentId)
      .limit(1)
      .maybeSingle();
    data = fallback.data as unknown;
    error = fallback.error;
  }

  if (error) return { enabled: false, funnelId: null, columnId: null, reason: "agent_config_select_failed" };
  if (!data || typeof data !== "object") return { enabled: false, funnelId: null, columnId: null, reason: "agent_config_not_found" };

  const row = data as Record<string, unknown>;
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  const enabled = unknownBoolean(row.crm_auto_move_enabled ?? metadata.crmAutoMoveEnabled ?? metadata.crm_auto_move_enabled);
  if (!enabled) return { enabled: false, funnelId: null, columnId: null, reason: "disabled" };

  const funnelId = unknownTextOrNull(row.crm_target_funnel_id)
    ?? unknownTextOrNull(metadata.crmTargetFunnelId)
    ?? unknownTextOrNull(metadata.crm_target_funnel_id);
  const columnId = unknownTextOrNull(row.crm_target_column_id)
    ?? unknownTextOrNull(row.crm_target_status)
    ?? unknownTextOrNull(metadata.crmTargetColumnId)
    ?? unknownTextOrNull(metadata.crmTargetStatus)
    ?? unknownTextOrNull(metadata.crm_target_column_id)
    ?? unknownTextOrNull(metadata.crm_target_status);

  if (!funnelId || !columnId) {
    return { enabled: false, funnelId, columnId, reason: "incomplete_config" };
  }

  return { enabled: true, funnelId, columnId };
}

function isUsefulExistingName(row: LeadRow, phone: string): boolean {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  return Boolean(name && name !== phone);
}

export function buildWhatsAppLeadInsertPayload(params: {
  tenantId: string;
  phone: string;
  contactName?: string | null;
  status: string;
  crmFunnelId?: string | null;
  agentId?: string | null;
  occurredAt: string;
}): LeadRow {
  return {
    tenant_id: params.tenantId,
    phone: params.phone,
    name: textOrNull(params.contactName),
    source: "whatsapp",
    status: params.status,
    ...(textOrNull(params.crmFunnelId) ? { crm_funnel_id: textOrNull(params.crmFunnelId) } : {}),
    agent_id: textOrNull(params.agentId),
    last_seen: params.occurredAt,
    last_message_at: params.occurredAt,
    created_at: params.occurredAt,
    updated_at: params.occurredAt,
  };
}

function buildExistingLeadUpdate(
  row: LeadRow,
  params: {
    phone: string;
    contactName?: string | null;
    agentId?: string | null;
    occurredAt: string;
    crmMoveTarget?: AgentCrmMoveTarget;
  },
): LeadRow {
  const patch: LeadRow = {};
  if ("last_seen" in row) patch.last_seen = params.occurredAt;
  if ("last_message_at" in row) patch.last_message_at = params.occurredAt;
  if ("updated_at" in row) patch.updated_at = params.occurredAt;
  if ("source" in row) patch.source = "whatsapp";
  if ("agent_id" in row && textOrNull(params.agentId)) patch.agent_id = textOrNull(params.agentId);
  if (params.crmMoveTarget?.enabled) {
    patch.status = params.crmMoveTarget.columnId;
    patch.crm_funnel_id = params.crmMoveTarget.funnelId;
  }
  if ("name" in row && textOrNull(params.contactName) && !isUsefulExistingName(row, params.phone)) {
    patch.name = textOrNull(params.contactName);
  }
  return patch;
}

async function updateExistingLead(
  sb: SupabaseServiceClient,
  row: LeadRow,
  params: {
    tenantId: string;
    phone: string;
    contactName?: string | null;
    agentId?: string | null;
    occurredAt: string;
    crmMoveTarget?: AgentCrmMoveTarget;
  },
): Promise<boolean> {
  const patch = buildExistingLeadUpdate(row, params);
  if (!Object.keys(patch).length) return false;

  const query = sb.from("leads").update(patch);
  const { error } =
    typeof row.id === "string" && row.id
      ? await query.eq("tenant_id", params.tenantId).eq("id", row.id)
      : await query.eq("tenant_id", params.tenantId).eq("phone", params.phone);

  if (error) {
    logAutoLeadUpsert({
      tenantId: params.tenantId,
      phone: params.phone,
      action: "error",
      reason: "update_failed",
      code: error.code,
    });
    if (isMissingColumnError(error, "crm_funnel_id") && "crm_funnel_id" in patch) {
      const { crm_funnel_id: _crmFunnelId, ...fallbackPatch } = patch;
      const fallbackQuery = sb.from("leads").update(fallbackPatch);
      const { error: fallbackError } =
        typeof row.id === "string" && row.id
          ? await fallbackQuery.eq("tenant_id", params.tenantId).eq("id", row.id)
          : await fallbackQuery.eq("tenant_id", params.tenantId).eq("phone", params.phone);
      return !fallbackError;
    }
    return false;
  }

  return true;
}

async function selectExistingLead(
  sb: SupabaseServiceClient,
  params: { tenantId: string; phone: string },
): Promise<{ row: LeadRow | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await sb
    .from("leads")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("phone", params.phone)
    .limit(1)
    .maybeSingle();

  return { row: (data as LeadRow | null) ?? null, error };
}

export async function upsertLeadFromWhatsAppContact(params: {
  tenantId: string;
  remoteJid?: string | null;
  phone?: string | null;
  contactName?: string | null;
  direction?: WhatsAppLeadDirection;
  agentId?: string | null;
  conversationId?: string | null;
  occurredAt?: string | null;
}): Promise<void> {
  const phone = normalizeWhatsAppPhone(params.phone ?? params.remoteJid);
  const invalidReason = invalidContactReason({
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    normalizedPhone: phone,
  });
  if (invalidReason || !isValidWhatsAppContact({
    remoteJid: params.remoteJid,
    phone: params.phone,
    normalizedPhone: phone,
  })) {
    logAutoLeadUpsert({
      tenantId: params.tenantId,
      phone,
      action: "skipped",
      reason: invalidReason ?? "invalid_contact",
      direction: params.direction,
    });
    return;
  }

  const sb = createSupabaseServiceClient();
  const occurredAt = textOrNull(params.occurredAt) ?? new Date().toISOString();
  const crmMoveTarget = await resolveAgentCrmMoveTarget(sb, {
    tenantId: params.tenantId,
    agentId: params.agentId,
  });
  const crmMoveAction: CrmMoveAction = crmMoveTarget.enabled
    ? "enabled"
    : crmMoveTarget.reason === "disabled" || crmMoveTarget.reason === "no_agent_config"
      ? "disabled"
      : "skipped";

  const { row: existing, error: selectError } = await selectExistingLead(sb, {
    tenantId: params.tenantId,
    phone,
  });

  if (selectError) {
    if (!isMissingTableError(selectError)) {
      logAutoLeadUpsert({
        tenantId: params.tenantId,
        phone,
        action: "error",
        reason: "select_failed",
        direction: params.direction,
        code: selectError.code,
        agentId: params.agentId,
        crmMove: crmMoveAction,
        targetFunnel: crmMoveTarget.funnelId,
        targetColumn: crmMoveTarget.columnId,
      });
    } else {
      logAutoLeadUpsert({
        tenantId: params.tenantId,
        phone,
        action: "skipped",
        reason: "leads_table_missing",
        direction: params.direction,
        code: selectError.code,
        agentId: params.agentId,
        crmMove: crmMoveAction,
        targetFunnel: crmMoveTarget.funnelId,
        targetColumn: crmMoveTarget.columnId,
      });
    }
    return;
  }

  if (existing) {
    const updated = await updateExistingLead(sb, existing as LeadRow, {
      tenantId: params.tenantId,
      phone,
      contactName: params.contactName,
      agentId: params.agentId,
      occurredAt,
      crmMoveTarget,
    });
    logAutoLeadUpsert({
      tenantId: params.tenantId,
      phone,
      action: updated ? "updated" : "skipped",
      reason: updated ? crmMoveTarget.reason : (crmMoveTarget.reason ?? "no_update_fields"),
      direction: params.direction,
      agentId: params.agentId,
      crmMove: crmMoveAction,
      targetFunnel: crmMoveTarget.funnelId,
      targetColumn: crmMoveTarget.columnId,
    });
    return;
  }

  const fallbackStatus = await resolveFirstKanbanStatus(sb, params.tenantId);
  const status = crmMoveTarget.enabled ? crmMoveTarget.columnId! : fallbackStatus;
  const payload = buildWhatsAppLeadInsertPayload({
    tenantId: params.tenantId,
    phone,
    contactName: params.contactName,
    status,
    crmFunnelId: crmMoveTarget.enabled ? crmMoveTarget.funnelId : null,
    agentId: params.agentId,
    occurredAt,
  });
  let { error: insertError } = await sb.from("leads").insert(payload);

  if (isMissingColumnError(insertError, "crm_funnel_id") && "crm_funnel_id" in payload) {
    const { crm_funnel_id: _crmFunnelId, ...fallbackPayload } = payload;
    const fallbackInsert = await sb.from("leads").insert(fallbackPayload);
    insertError = fallbackInsert.error;
  }

  if (insertError) {
    if (DUPLICATE_KEY_CODES.has(insertError.code ?? "")) {
      const { row: conflicted, error: conflictSelectError } = await selectExistingLead(sb, {
        tenantId: params.tenantId,
        phone,
      });
      if (conflictSelectError || !conflicted) {
        logAutoLeadUpsert({
          tenantId: params.tenantId,
          phone,
          action: "error",
          reason: "duplicate_conflict_lookup_failed",
          direction: params.direction,
          code: conflictSelectError?.code ?? "not_found",
          agentId: params.agentId,
          crmMove: crmMoveAction,
          targetFunnel: crmMoveTarget.funnelId,
          targetColumn: crmMoveTarget.columnId,
        });
        return;
      }
      await updateExistingLead(sb, conflicted, {
        tenantId: params.tenantId,
        phone,
        contactName: params.contactName,
        agentId: params.agentId,
        occurredAt,
        crmMoveTarget,
      });
      logAutoLeadUpsert({
        tenantId: params.tenantId,
        phone,
        action: "conflict_updated",
        direction: params.direction,
        agentId: params.agentId,
        crmMove: crmMoveAction,
        targetFunnel: crmMoveTarget.funnelId,
        targetColumn: crmMoveTarget.columnId,
      });
      return;
    }
    if (!isMissingTableError(insertError)) {
      logAutoLeadUpsert({
        tenantId: params.tenantId,
        phone,
        action: "error",
        reason: "insert_failed",
        direction: params.direction,
        code: insertError.code,
        agentId: params.agentId,
        crmMove: crmMoveAction,
        targetFunnel: crmMoveTarget.funnelId,
        targetColumn: crmMoveTarget.columnId,
      });
    } else {
      logAutoLeadUpsert({
        tenantId: params.tenantId,
        phone,
        action: "skipped",
        reason: "leads_table_missing",
        direction: params.direction,
        code: insertError.code,
        agentId: params.agentId,
        crmMove: crmMoveAction,
        targetFunnel: crmMoveTarget.funnelId,
        targetColumn: crmMoveTarget.columnId,
      });
    }
    return;
  }

  logAutoLeadUpsert({
    tenantId: params.tenantId,
    phone,
    action: "created",
    direction: params.direction ?? "inbound",
    agentId: params.agentId,
    crmMove: crmMoveAction,
    targetFunnel: crmMoveTarget.funnelId,
    targetColumn: crmMoveTarget.columnId,
    reason: crmMoveTarget.reason,
  });
}

export async function autoUpsertLeadFromWhatsApp(params: {
  tenantId: string;
  remoteJid: string;
  contactName?: string | null;
  agentId?: string | null;
  conversationId?: string | null;
}): Promise<void> {
  return upsertLeadFromWhatsAppContact({
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    contactName: params.contactName,
    direction: "inbound",
    agentId: params.agentId,
    conversationId: params.conversationId ?? params.remoteJid,
  });
}
