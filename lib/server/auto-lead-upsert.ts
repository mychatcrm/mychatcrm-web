import { DEFAULT_CRM_FUNNELS } from "@/lib/crm-funnels";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type LeadRow = Record<string, unknown>;

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code));
}

export function phoneFromRemoteJid(remoteJid: string): string {
  return remoteJid.split("@")[0]?.replace(/\D/g, "") ?? "";
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

function buildExistingLeadUpdate(row: LeadRow, now: string): LeadRow {
  const patch: LeadRow = {};
  if ("last_seen" in row) patch.last_seen = now;
  if ("last_message_at" in row) patch.last_message_at = now;
  if ("updated_at" in row) patch.updated_at = now;
  return patch;
}

export async function autoUpsertLeadFromWhatsApp(params: {
  tenantId: string;
  remoteJid: string;
  contactName?: string | null;
}): Promise<void> {
  const phone = phoneFromRemoteJid(params.remoteJid);
  if (!params.tenantId.trim() || !phone) return;

  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();

  const { data: existing, error: selectError } = await sb
    .from("leads")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

  if (selectError) {
    if (!isMissingTableError(selectError)) {
      console.warn("[auto-lead-upsert] select", selectError.code, selectError.message);
    }
    return;
  }

  if (existing) {
    const patch = buildExistingLeadUpdate(existing as LeadRow, now);
    if (!Object.keys(patch).length) return;

    const existingRow = existing as LeadRow;
    const query = sb.from("leads").update(patch);
    const { error: updateError } =
      typeof existingRow.id === "string" && existingRow.id
        ? await query.eq("id", existingRow.id)
        : await query.eq("tenant_id", params.tenantId).eq("phone", phone);

    if (updateError) {
      console.warn("[auto-lead-upsert] update", updateError.code, updateError.message);
    }
    return;
  }

  const status = await resolveFirstKanbanStatus(sb, params.tenantId);
  const cleanName = params.contactName?.trim() || null;
  const { error: insertError } = await sb.from("leads").insert({
    tenant_id: params.tenantId,
    phone,
    name: cleanName,
    source: "whatsapp",
    status,
    created_at: now,
  });

  if (insertError) {
    if (!isMissingTableError(insertError)) {
      console.warn("[auto-lead-upsert] insert", insertError.code, insertError.message);
    }
  }
}
