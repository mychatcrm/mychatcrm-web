import { DEFAULT_CRM_FUNNELS } from "@/lib/crm-funnels";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type LeadRow = Record<string, unknown>;
type WhatsAppLeadDirection = "inbound" | "outbound";
type AutoLeadLogAction = "created" | "updated" | "skipped" | "conflict_updated" | "error";

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const DUPLICATE_KEY_CODES = new Set(["23505"]);
const MIN_WHATSAPP_PHONE_DIGITS = 8;

function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code));
}

function logAutoLeadUpsert(params: {
  tenantId: string;
  phone?: string | null;
  action: AutoLeadLogAction;
  reason?: string;
  direction?: WhatsAppLeadDirection;
  code?: string | null;
}): void {
  const payload: Record<string, string> = {
    tenant_id: params.tenantId,
    phone_last4: params.phone ? params.phone.slice(-4) : "none",
    action: params.action,
  };
  if (params.reason) payload.reason = params.reason;
  if (params.direction) payload.direction = params.direction;
  if (params.code) payload.code = params.code;

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

function isUsefulExistingName(row: LeadRow, phone: string): boolean {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  return Boolean(name && name !== phone);
}

export function buildWhatsAppLeadInsertPayload(params: {
  tenantId: string;
  phone: string;
  contactName?: string | null;
  status: string;
  agentId?: string | null;
  occurredAt: string;
}): LeadRow {
  return {
    tenant_id: params.tenantId,
    phone: params.phone,
    name: textOrNull(params.contactName),
    source: "whatsapp",
    status: params.status,
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
  },
): LeadRow {
  const patch: LeadRow = {};
  if ("last_seen" in row) patch.last_seen = params.occurredAt;
  if ("last_message_at" in row) patch.last_message_at = params.occurredAt;
  if ("updated_at" in row) patch.updated_at = params.occurredAt;
  if ("source" in row) patch.source = "whatsapp";
  if ("agent_id" in row && textOrNull(params.agentId)) patch.agent_id = textOrNull(params.agentId);
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
      });
    } else {
      logAutoLeadUpsert({
        tenantId: params.tenantId,
        phone,
        action: "skipped",
        reason: "leads_table_missing",
        direction: params.direction,
        code: selectError.code,
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
    });
    logAutoLeadUpsert({
      tenantId: params.tenantId,
      phone,
      action: updated ? "updated" : "skipped",
      reason: updated ? undefined : "no_update_fields",
      direction: params.direction,
    });
    return;
  }

  const status = await resolveFirstKanbanStatus(sb, params.tenantId);
  const { error: insertError } = await sb.from("leads").insert(buildWhatsAppLeadInsertPayload({
    tenantId: params.tenantId,
    phone,
    contactName: params.contactName,
    status,
    agentId: params.agentId,
    occurredAt,
  }));

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
        });
        return;
      }
      await updateExistingLead(sb, conflicted, {
        tenantId: params.tenantId,
        phone,
        contactName: params.contactName,
        agentId: params.agentId,
        occurredAt,
      });
      logAutoLeadUpsert({
        tenantId: params.tenantId,
        phone,
        action: "conflict_updated",
        direction: params.direction,
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
      });
    } else {
      logAutoLeadUpsert({
        tenantId: params.tenantId,
        phone,
        action: "skipped",
        reason: "leads_table_missing",
        direction: params.direction,
        code: insertError.code,
      });
    }
    return;
  }

  logAutoLeadUpsert({
    tenantId: params.tenantId,
    phone,
    action: "created",
    direction: params.direction ?? "inbound",
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
