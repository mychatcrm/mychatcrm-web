import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_OWNER_ID } from "@/lib/agent-test-lab/policy";
import { LAB_TENANT_PREFIX } from "./isolation";
import { cancelAgendaRemindersForEvent } from "@/lib/server/agenda-reminder-jobs";
import { labAudit } from "./auth";
import { recordLabEffects } from "./effects";
import { syncAtomicAgendaMutation, type AtomicAgendaMutationResult } from "@/lib/server/agent-cta-scheduler";
import { requireCertifiedLabCapability } from "@/lib/agent-test-lab/safety-policy";

export type LabCleanupItem = {
  id: string; resourceType: string; resourceId: string; tenantId: string;
  cleanupStatus: string; label: string;
};

/**
 * The reviewable list of what this run created. Nothing is touched by listing it:
 * the owner decides, item by item, and messages already delivered and appointments
 * already confirmed with a real person are never undone automatically.
 */
export async function listLabRunResources(runId: string): Promise<LabCleanupItem[]> {
  const sb = createSupabaseServiceClient();
  const run = await sb.from("agent_test_lab_runs").select("id").eq("id", runId).eq("owner_admin_id", LAB_OWNER_ID).single();
  if (run.error || !run.data) throw new Error("run_missing");
  // Refresh first, so the list reflects effects that landed after the last tick.
  await recordLabEffects(runId);
  const rows = await sb.from("agent_test_lab_resources")
    .select("id,resource_type,resource_id,tenant_id,cleanup_status").eq("run_id", runId).limit(1000);
  if (rows.error) throw new Error("resources_read_failed");
  const label: Record<string, string> = {
    lead: "Lead criado pelo teste", agenda_event: "Compromisso criado pelo teste",
    needs_owner_review: "Requer sua decisão manual",
  };
  return (rows.data ?? []).map(row => ({
    id: String(row.id), resourceType: String(row.resource_type), resourceId: String(row.resource_id),
    tenantId: String(row.tenant_id), cleanupStatus: String(row.cleanup_status),
    label: label[String(row.resource_type)] ?? String(row.resource_type),
  }));
}

/**
 * Cleans up exactly the resources the owner selected, and only if this run is
 * recorded as their owner. Appointments are cancelled through the same mutation the
 * agent itself uses, so the Google Calendar sync and the reminder cancellation
 * happen through the normal flows instead of a direct delete behind their back.
 */
export async function cleanupLabRunResources(runId: string, resourceIds: string[]): Promise<{ cleaned: number; failed: number }> {
  const sb = createSupabaseServiceClient();
  const run = await sb.from("agent_test_lab_runs").select("id,target_agent_id,status")
    .eq("id", runId).eq("owner_admin_id", LAB_OWNER_ID).single();
  if (run.error || !run.data) throw new Error("run_missing");
  if (!["completed", "failed", "cancelled"].includes(String(run.data.status))) throw new Error("run_still_open");
  // Legacy resources were inferred only from contact/time and are not safe to
  // delete. Explicit run-to-mutation ownership is required before enabling cleanup.
  requireCertifiedLabCapability("cleanup_ownership");

  const rows = await sb.from("agent_test_lab_resources")
    .select("id,resource_type,resource_id,tenant_id,cleanup_status")
    .eq("run_id", runId).in("id", resourceIds.slice(0, 200));
  if (rows.error) throw new Error("resources_read_failed");

  let cleaned = 0, failed = 0;
  for (const row of rows.data ?? []) {
    if (row.cleanup_status === "cleaned") continue;
    try {
      if (row.resource_type === "agenda_event") {
        const event = await sb.from("agenda_events").select("attendee_phone")
          .eq("tenant_id", row.tenant_id).eq("id", row.resource_id).single();
        if (event.error || !event.data?.attendee_phone) throw new Error("agenda_event_identity_missing");
        const operationKey = `lab-cleanup:${runId}:${row.resource_id}`;
        const cancelled = await sb.rpc("apply_agent_agenda_mutation", {
          p_tenant_id: row.tenant_id, p_operation_key: operationKey,
          p_action: "cancel", p_attendee_phone: event.data.attendee_phone, p_event_id: row.resource_id,
          p_title: null, p_description: null, p_location: null, p_start_at: null, p_end_at: null,
          p_attendee_name: null, p_lead_id: null, p_agent_id: run.data.target_agent_id,
          p_allow_simultaneous: false,
        });
        if (cancelled.error || !cancelled.data?.event?.id || cancelled.data.action !== "cancelled") throw new Error("agenda_cancel_failed");
        await cancelAgendaRemindersForEvent({
          sb, tenantId: String(row.tenant_id), agendaEventId: String(row.resource_id), reason: "agent_test_lab_cleanup",
        });
        const synced = await syncAtomicAgendaMutation({ sb, tenantId: String(row.tenant_id), operationKey,
          result: cancelled.data as AtomicAgendaMutationResult });
        if (synced.operation_status !== "completed") throw new Error("agenda_sync_pending");
      } else if (row.resource_type === "lead") {
        // A lead inside the laboratory tenant is test data and is removed. A lead in
        // a customer's CRM is not: leads.status has no "archived" value, so writing
        // one would invent a column on their board. That one stays for the owner to
        // decide by hand, and says so instead of pretending it was handled.
        if (!String(row.tenant_id).startsWith(LAB_TENANT_PREFIX)) {
          await sb.from("agent_test_lab_resources").update({ cleanup_status: "needs_owner_review" }).eq("id", row.id);
          failed += 1;
          continue;
        }
        const removed = await sb.from("leads").delete().eq("id", row.resource_id).eq("tenant_id", row.tenant_id);
        if (removed.error) throw new Error("lead_delete_failed");
      } else {
        failed += 1;
        continue;
      }
      await sb.from("agent_test_lab_resources").update({ cleanup_status: "cleaned" }).eq("id", row.id);
      cleaned += 1;
    } catch {
      await sb.from("agent_test_lab_resources").update({ cleanup_status: "failed" }).eq("id", row.id);
      failed += 1;
    }
  }
  await labAudit("run.cleanup_applied", runId, failed ? "error" : "completed");
  return { cleaned, failed };
}
