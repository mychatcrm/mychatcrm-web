import { upsertLeadFromWhatsAppContact } from "@/lib/server/auto-lead-upsert";
import { CRM_KANBAN_STATUS_NOVO } from "@/lib/server/crm-lead-lifecycle";
import { DEFAULT_CRM_FUNNELS, migrateFunnelColumns } from "@/lib/crm-funnels";
import { resolveLeadStatusForFunnelColumns } from "@/lib/crm-funnel-migration";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type OrphanConversationIssue = {
  kind:
    | "state_without_lead"
    | "message_without_lead"
    | "lead_invalid_status"
    | "lead_missing_funnel"
    | "duplicate_state_jid"
    | "job_without_lead";
  tenant_id: string;
  remote_jid?: string;
  lead_id?: string;
  detail?: string;
};

export type OrphanConversationReport = {
  tenantId: string;
  issues: OrphanConversationIssue[];
  counts: Record<string, number>;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function phoneFromRemoteJid(remoteJid: string): string | null {
  const digits = digitsOnly(remoteJid.split("@")[0] ?? remoteJid);
  return digits.length >= 10 ? digits : null;
}

export async function findOrphanConversations(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
}): Promise<OrphanConversationReport> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const issues: OrphanConversationIssue[] = [];

  const { data: states } = await sb
    .from("conversation_states")
    .select("id, remote_jid, lead_id")
    .eq("tenant_id", params.tenantId)
    .eq("channel", "whatsapp");

  const jidSeen = new Map<string, number>();
  for (const row of states ?? []) {
    const jid = String(row.remote_jid ?? "");
    if (!jid) continue;
    jidSeen.set(jid, (jidSeen.get(jid) ?? 0) + 1);
    if (!row.lead_id) {
      issues.push({
        kind: "state_without_lead",
        tenant_id: params.tenantId,
        remote_jid: jid,
        detail: "conversation_state sem lead_id",
      });
    }
  }
  for (const [jid, count] of jidSeen) {
    if (count > 1) {
      issues.push({
        kind: "duplicate_state_jid",
        tenant_id: params.tenantId,
        remote_jid: jid,
        detail: `${count} states para o mesmo jid`,
      });
    }
  }

  const { data: messages } = await sb
    .from("whatsapp_messages")
    .select("id, remote_jid, lead_id")
    .eq("tenant_id", params.tenantId)
    .is("lead_id", null)
    .limit(500);

  const messageJids = new Set<string>();
  for (const row of messages ?? []) {
    const jid = String(row.remote_jid ?? "");
    if (!jid || messageJids.has(jid)) continue;
    messageJids.add(jid);
    issues.push({
      kind: "message_without_lead",
      tenant_id: params.tenantId,
      remote_jid: jid,
      detail: "whatsapp_messages sem lead_id",
    });
  }

  const { data: leads } = await sb
    .from("leads")
    .select("id, status, crm_funnel_id, phone")
    .eq("tenant_id", params.tenantId);

  const defaultColumns = migrateFunnelColumns(DEFAULT_CRM_FUNNELS[0]?.columns ?? []);
  for (const row of leads ?? []) {
    const id = String(row.id ?? "");
    const status = String(row.status ?? "").trim();
    const resolved = resolveLeadStatusForFunnelColumns(status, defaultColumns);
    if (status && status !== resolved) {
      issues.push({
        kind: "lead_invalid_status",
        tenant_id: params.tenantId,
        lead_id: id,
        detail: `status "${status}" → "${resolved}"`,
      });
    }
    if (!row.crm_funnel_id) {
      issues.push({
        kind: "lead_missing_funnel",
        tenant_id: params.tenantId,
        lead_id: id,
        detail: "crm_funnel_id ausente",
      });
    }
  }

  const { data: jobs } = await sb
    .from("agent_response_jobs")
    .select("id, remote_jid, lead_id")
    .eq("tenant_id", params.tenantId)
    .is("lead_id", null)
    .limit(200);

  for (const row of jobs ?? []) {
    issues.push({
      kind: "job_without_lead",
      tenant_id: params.tenantId,
      remote_jid: String(row.remote_jid ?? ""),
      detail: `agent_response_job ${row.id}`,
    });
  }

  const counts: Record<string, number> = {};
  for (const issue of issues) {
    counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
  }

  return { tenantId: params.tenantId, issues, counts };
}

export type RepairCrmConversationReport = {
  tenantId: string;
  leadsCreated: number;
  statesLinked: number;
  leadsStatusFixed: number;
  leadsFunnelFixed: number;
  orphanJobsRemoved: number;
  orphanStatesRemoved: number;
};

export async function repairCrmConversationConsistency(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
}): Promise<RepairCrmConversationReport> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const report: RepairCrmConversationReport = {
    tenantId: params.tenantId,
    leadsCreated: 0,
    statesLinked: 0,
    leadsStatusFixed: 0,
    leadsFunnelFixed: 0,
    orphanJobsRemoved: 0,
    orphanStatesRemoved: 0,
  };

  const { data: leads } = await sb
    .from("leads")
    .select("id, phone, name, status, crm_funnel_id")
    .eq("tenant_id", params.tenantId);

  const phoneToLeadId = new Map<string, string>();
  for (const row of leads ?? []) {
    const phone = digitsOnly(String(row.phone ?? ""));
    if (phone) phoneToLeadId.set(phone, String(row.id));
  }

  const defaultColumns = migrateFunnelColumns(DEFAULT_CRM_FUNNELS[0]?.columns ?? []);

  const { data: states } = await sb
    .from("conversation_states")
    .select("id, remote_jid, lead_id")
    .eq("tenant_id", params.tenantId)
    .eq("channel", "whatsapp");

  for (const state of states ?? []) {
    const jid = String(state.remote_jid ?? "");
    if (!jid) continue;
    let leadId = state.lead_id ? String(state.lead_id) : null;

    if (!leadId) {
      const phone = phoneFromRemoteJid(jid);
      if (phone) leadId = phoneToLeadId.get(phone) ?? null;
    }

    if (!leadId) {
      const phone = phoneFromRemoteJid(jid);
      if (!phone) continue;
      const upsert = await upsertLeadFromWhatsAppContact({
        tenantId: params.tenantId,
        remoteJid: jid,
        phone,
        source: "whatsapp",
        direction: "inbound",
      });
      leadId = upsert.lead?.id ?? null;
      if (leadId) {
        report.leadsCreated += 1;
        phoneToLeadId.set(phone, leadId);
      }
    }

    if (leadId && state.lead_id !== leadId) {
      await sb
        .from("conversation_states")
        .update({ lead_id: leadId, updated_at: new Date().toISOString() })
        .eq("tenant_id", params.tenantId)
        .eq("id", state.id);
      report.statesLinked += 1;

      await sb
        .from("whatsapp_messages")
        .update({ lead_id: leadId })
        .eq("tenant_id", params.tenantId)
        .eq("remote_jid", jid)
        .is("lead_id", null);
    }
  }

  for (const row of leads ?? []) {
    const id = String(row.id);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let changed = false;

    const status = String(row.status ?? "").trim();
    const resolved = resolveLeadStatusForFunnelColumns(status || CRM_KANBAN_STATUS_NOVO, defaultColumns);
    if (status !== resolved) {
      patch.status = resolved;
      changed = true;
      report.leadsStatusFixed += 1;
    }

    if (!row.crm_funnel_id) {
      patch.crm_funnel_id = "funil-default";
      changed = true;
      report.leadsFunnelFixed += 1;
    }

    if (changed) {
      await sb.from("leads").update(patch).eq("tenant_id", params.tenantId).eq("id", id);
    }
  }

  const { data: orphanJobs } = await sb
    .from("agent_response_jobs")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .is("lead_id", null);
  if (orphanJobs?.length) {
    const ids = orphanJobs.map((r) => String(r.id));
    await sb.from("agent_response_jobs").delete().eq("tenant_id", params.tenantId).in("id", ids);
    report.orphanJobsRemoved = ids.length;
  }

  return report;
}
