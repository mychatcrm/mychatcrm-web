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
  metaEventsDeleted: number;
  followUpJobsDeleted: number;
  followUpEventsDeleted: number;
  agentJobsDeleted: number;
  conversationEventsDeleted: number;
  timelineDeleted: number;
};

/** Alias público — CRM é fonte de verdade; exclusão em cascata total. */
export const deleteLeadCascade = deleteLeadCompletely;

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function isTenantMediaKey(tenantId: string, key: string): boolean {
  return key.startsWith(`whatsapp/${tenantId}/`);
}

async function deleteByLeadOrJids(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  table: string;
  leadIds: string[];
  jidList: string[];
  jidColumn?: string;
}): Promise<number> {
  let total = 0;
  const jidColumn = params.jidColumn ?? "remote_jid";

  if (params.leadIds.length) {
    const { count } = await params.sb
      .from(params.table)
      .delete({ count: "exact" })
      .eq("tenant_id", params.tenantId)
      .in("lead_id", params.leadIds);
    total += count ?? 0;
  }

  if (params.jidList.length) {
    const { count } = await params.sb
      .from(params.table)
      .delete({ count: "exact" })
      .eq("tenant_id", params.tenantId)
      .in(jidColumn, params.jidList);
    total += count ?? 0;
  }

  return total;
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

  console.info("[delete-lead-cascade] start", {
    tenant_id: params.tenantId,
    lead_ids: leadIds,
  });

  const { data: leads, error: leadsError } = await sb
    .from("leads")
    .select("id, phone, name")
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
      metaEventsDeleted: 0,
      followUpJobsDeleted: 0,
      followUpEventsDeleted: 0,
      agentJobsDeleted: 0,
      conversationEventsDeleted: 0,
      timelineDeleted: 0,
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

  const jidList = [...remoteJids];

  const summariesDeleted = await deleteByLeadOrJids({
    sb,
    tenantId: params.tenantId,
    table: "conversation_summaries",
    leadIds: resolvedIds,
    jidList,
  });

  const statesDeleted = await deleteByLeadOrJids({
    sb,
    tenantId: params.tenantId,
    table: "conversation_states",
    leadIds: resolvedIds,
    jidList,
  });

  const followUpJobsDeleted = await deleteByLeadOrJids({
    sb,
    tenantId: params.tenantId,
    table: "follow_up_jobs",
    leadIds: resolvedIds,
    jidList,
  });

  const followUpEventsDeleted = await deleteByLeadOrJids({
    sb,
    tenantId: params.tenantId,
    table: "agent_followup_events",
    leadIds: resolvedIds,
    jidList,
  });

  const agentJobsDeleted = await deleteByLeadOrJids({
    sb,
    tenantId: params.tenantId,
    table: "agent_response_jobs",
    leadIds: resolvedIds,
    jidList,
  });

  const conversationEventsDeleted = await deleteByLeadOrJids({
    sb,
    tenantId: params.tenantId,
    table: "conversation_events",
    leadIds: resolvedIds,
    jidList,
  });

  const timelineDeleted = await deleteByLeadOrJids({
    sb,
    tenantId: params.tenantId,
    table: "crm_follow_up_timeline",
    leadIds: resolvedIds,
    jidList: [],
  });

  let metaEventsDeleted = 0;
  const { count: metaByLead = 0 } = await sb
    .from("meta_lead_events")
    .delete({ count: "exact" })
    .eq("tenant_id", params.tenantId)
    .in("lead_id", resolvedIds);
  metaEventsDeleted += metaByLead ?? 0;

  for (const phone of phones) {
    const { count } = await sb
      .from("meta_lead_events")
      .delete({ count: "exact" })
      .eq("tenant_id", params.tenantId)
      .ilike("phone", `%${phone}%`);
    metaEventsDeleted += count ?? 0;
  }

  const { count: offerLinksDeleted = 0 } = await sb
    .from("active_offer_leads")
    .delete({ count: "exact" })
    .eq("tenant_id", params.tenantId)
    .in("lead_id", resolvedIds);

  const { count: offerProgressDeleted = 0 } = await sb
    .from("active_offer_lead_progress")
    .delete({ count: "exact" })
    .eq("tenant_id", params.tenantId)
    .in("lead_id", resolvedIds);

  const { count: leadDeleted = 0 } = await sb
    .from("leads")
    .delete({ count: "exact" })
    .eq("tenant_id", params.tenantId)
    .in("id", resolvedIds);

  const relatedRecordsDeleted =
    (offerLinksDeleted ?? 0) +
    (offerProgressDeleted ?? 0) +
    metaEventsDeleted +
    followUpJobsDeleted +
    followUpEventsDeleted +
    agentJobsDeleted +
    conversationEventsDeleted +
    timelineDeleted;

  console.info("[delete-lead-cascade] done", {
    tenant_id: params.tenantId,
    lead_ids: resolvedIds,
    lead_deleted: leadDeleted,
    messages_deleted: messagesDeleted,
    states_deleted: statesDeleted,
    related_records_deleted: relatedRecordsDeleted,
  });

  return {
    leadIds: resolvedIds,
    leadDeleted: leadDeleted ?? resolvedIds.length,
    messagesDeleted,
    summariesDeleted,
    statesDeleted,
    mediaDeleted,
    mediaFailed,
    relatedRecordsDeleted,
    metaEventsDeleted,
    followUpJobsDeleted,
    followUpEventsDeleted,
    agentJobsDeleted,
    conversationEventsDeleted,
    timelineDeleted,
  };
}
