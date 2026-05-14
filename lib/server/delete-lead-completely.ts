import { deleteR2Object } from "@/lib/integrations/r2-storage";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { normalizeCrmLeadIds, validateCrmLeadIds } from "@/lib/server/crm-leads-delete";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type DeleteLeadCompletelyReport = {
  leadIds: string[];
  leadDeleted: number;
  messagesDeleted: number;
  summariesDeleted: number;
  statesDeleted: number;
  mediaDeleted: number;
  mediaFailed: string[];
  relatedRecordsDeleted: number;
};

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function isTenantMediaKey(tenantId: string, key: string): boolean {
  return key.startsWith(`whatsapp/${tenantId}/`);
}

export async function deleteLeadCompletely(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  leadIds: string[];
}): Promise<DeleteLeadCompletelyReport> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const leadIds = normalizeCrmLeadIds(params.leadIds);
  const validationError = validateCrmLeadIds(leadIds);
  if (validationError) throw new Error(validationError);

  const { data: leads, error: leadsError } = await sb
    .from("leads")
    .select("id, phone")
    .eq("tenant_id", params.tenantId)
    .in("id", leadIds);

  if (leadsError) throw new Error("Erro ao carregar leads para exclusão.");
  const resolvedIds = (leads ?? []).map((row) => String((row as { id: string }).id));
  if (!resolvedIds.length) {
    return {
      leadIds: [],
      leadDeleted: 0,
      messagesDeleted: 0,
      summariesDeleted: 0,
      statesDeleted: 0,
      mediaDeleted: 0,
      mediaFailed: [],
      relatedRecordsDeleted: 0,
    };
  }

  const phones = (leads ?? [])
    .map((row) => normalizePhone((row as { phone?: unknown }).phone))
    .filter(Boolean);

  const remoteJids = new Set<string>();
  const { data: stateRows } = await sb
    .from("conversation_states")
    .select("remote_jid")
    .eq("tenant_id", params.tenantId)
    .in("lead_id", resolvedIds);
  for (const row of stateRows ?? []) {
    const jid = String((row as { remote_jid?: unknown }).remote_jid ?? "");
    if (jid) remoteJids.add(jid);
  }

  const messageIdSet = new Set<string>();
  const storageKeys = new Set<string>();

  const collectMessages = (rows: Array<Record<string, unknown>> | null) => {
    for (const row of rows ?? []) {
      const id = row.id;
      const key = row.storage_key;
      if (typeof id === "string") messageIdSet.add(id);
      if (typeof key === "string" && key.trim()) storageKeys.add(key.trim());
      const jid = row.remote_jid;
      if (typeof jid === "string" && jid) remoteJids.add(jid);
    }
  };

  const { data: byLeadId } = await sb
    .from("whatsapp_messages")
    .select("id, storage_key, remote_jid")
    .eq("tenant_id", params.tenantId)
    .in("lead_id", resolvedIds);
  collectMessages((byLeadId ?? []) as Array<Record<string, unknown>>);

  for (const phone of phones) {
    const { data: byPhone } = await sb
      .from("whatsapp_messages")
      .select("id, storage_key, remote_jid")
      .eq("tenant_id", params.tenantId)
      .ilike("remote_jid", `${phone}%`);
    collectMessages((byPhone ?? []) as Array<Record<string, unknown>>);
  }

  const mediaFailed: string[] = [];
  let mediaDeleted = 0;
  for (const key of storageKeys) {
    if (!isTenantMediaKey(params.tenantId, key)) continue;
    try {
      await deleteR2Object(key);
      mediaDeleted += 1;
    } catch {
      mediaFailed.push(key);
    }
  }

  let messagesDeleted = 0;
  const messageIds = [...messageIdSet];
  if (messageIds.length) {
    const { count } = await sb
      .from("whatsapp_messages")
      .delete({ count: "exact" })
      .eq("tenant_id", params.tenantId)
      .in("id", messageIds);
    messagesDeleted = count ?? messageIds.length;
  }

  const { count: summariesDeleted = 0 } = await sb
    .from("conversation_summaries")
    .delete({ count: "exact" })
    .eq("tenant_id", params.tenantId)
    .in("lead_id", resolvedIds);

  let statesDeleted = 0;
  const byLeadStates = await sb
    .from("conversation_states")
    .delete({ count: "exact" })
    .eq("tenant_id", params.tenantId)
    .in("lead_id", resolvedIds);
  statesDeleted += byLeadStates.count ?? 0;

  const jidList = [...remoteJids];
  if (jidList.length) {
    const byJidStates = await sb
      .from("conversation_states")
      .delete({ count: "exact" })
      .eq("tenant_id", params.tenantId)
      .in("remote_jid", jidList);
    statesDeleted += byJidStates.count ?? 0;
  }

  const { count: offerLinksDeleted = 0 } = await sb
    .from("active_offer_leads")
    .delete({ count: "exact" })
    .eq("tenant_id", params.tenantId)
    .in("lead_id", resolvedIds);

  const { count: leadDeleted = 0 } = await sb
    .from("leads")
    .delete({ count: "exact" })
    .eq("tenant_id", params.tenantId)
    .in("id", resolvedIds);

  return {
    leadIds: resolvedIds,
    leadDeleted: leadDeleted ?? resolvedIds.length,
    messagesDeleted,
    summariesDeleted: summariesDeleted ?? 0,
    statesDeleted,
    mediaDeleted,
    mediaFailed,
    relatedRecordsDeleted: offerLinksDeleted ?? 0,
  };
}
