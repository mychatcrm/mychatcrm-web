import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  evolutionCreateInstance, evolutionFetchInstances, evolutionInstanceConnect,
  evolutionDeleteInstance, evolutionLogoutInstance, isEvolutionApiConfigured,
  applyClientEvolutionInstanceSettings, CLIENT_EVOLUTION_INSTANCE_SETTINGS,
} from "@/lib/integrations/evolution-api";
import { buildEvolutionWebhookUrl } from "@/lib/integrations/evolution-webhook-url";
import { normalizeInstanceConnectToQrDataUrl } from "@/lib/integrations/evolution-connect-qr";
import { LAB_OWNER_ID, labMaskedJid, labPhoneJid } from "@/lib/agent-test-lab/policy";
import { labAudit, labHash } from "./auth";
import { provisionLabIsolatedAgent, labTenantIdFor } from "./isolation";

export const LAB_RECEIVER_PREFIX = "mychatcrm-lab-receiver-";

async function getLabReceiverRow() {
  const result = await createSupabaseServiceClient().from("agent_test_lab_connections")
    .select("id,instance_name,state,wa_jid,updated_at")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "receiver").is("archived_at", null).maybeSingle();
  if (result.error) throw new Error("receiver_read_failed");
  if (result.data && !result.data.instance_name.startsWith(LAB_RECEIVER_PREFIX)) throw new Error("receiver_identity_invalid");
  return result.data;
}

export async function inspectLabReceiver() {
  const row = await getLabReceiverRow();
  if (!row) return null;
  const sb = createSupabaseServiceClient();
  const routed = await sb.from("tenant_evolution_instances").select("id,tenant_id,organic_agent_id")
    .eq("instance_name", row.instance_name).maybeSingle();
  if (routed.error) throw new Error("receiver_routing_read_failed");
  return {
    id: row.id, state: row.state, number: labMaskedJid(row.wa_jid), updatedAt: row.updated_at,
    labTenantId: routed.data?.tenant_id ?? null, labAgentId: routed.data?.organic_agent_id ?? null,
    connectionId: routed.data?.id ?? null,
  };
}

async function refreshReceiver() {
  const row = await getLabReceiverRow();
  if (!row) return null;
  const result = await evolutionFetchInstances(row.instance_name);
  if (!result.ok) throw new Error("receiver_provider_unavailable");
  const exact = result.data.find(item => item.name === row.instance_name);
  const jid = labPhoneJid(exact?.ownerJid);
  let state = exact?.connectionStatus === "open" && jid ? "open" : exact ? "connecting" : "absent";
  const sb = createSupabaseServiceClient();
  if (state === "open" && jid) {
    // The answering line must not be a customer's, nor the tester's own number.
    const foreign = await sb.from("tenant_evolution_instances").select("instance_name").eq("wa_jid", jid);
    if (foreign.error) throw new Error("receiver_isolation_unconfirmed");
    if ((foreign.data ?? []).some(item => item.instance_name !== row.instance_name)) {
      state = "conflict";
      await labAudit("receiver.number_collision", row.id, "blocked");
      await evolutionLogoutInstance(row.instance_name);
    }
    const tester = await sb.from("agent_test_lab_connections").select("id")
      .eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "sender").eq("wa_jid", jid).is("archived_at", null).maybeSingle();
    if (tester.error) throw new Error("receiver_isolation_unconfirmed");
    if (tester.data) {
      state = "conflict";
      await labAudit("receiver.same_as_tester", row.id, "blocked");
      await evolutionLogoutInstance(row.instance_name);
    }
  }
  const saved = await sb.from("agent_test_lab_connections")
    .update({ state, wa_jid: state === "conflict" ? null : jid, updated_at: new Date().toISOString() })
    .eq("id", row.id).is("archived_at", null);
  if (saved.error) throw new Error("receiver_update_failed");
  if (state !== "conflict") {
    const routed = await sb.from("tenant_evolution_instances")
      .update({ wa_jid: jid, connection_state: state === "open" ? "open" : "connecting", updated_at: new Date().toISOString() })
      .eq("instance_name", row.instance_name);
    if (routed.error) throw new Error("receiver_routing_update_failed");
  }
  return { ...row, state, wa_jid: jid };
}

/**
 * Connects the line the isolated copy answers on.
 *
 * It is registered in tenant_evolution_instances under the laboratory tenant and
 * points at the production webhook on purpose: an organic WhatsApp test has to go
 * through the real intake and the real rules, or it proves nothing about them.
 */
export async function connectLabReceiver(sourceTenantId: string, sourceAgentId: string) {
  if (!isEvolutionApiConfigured()) throw new Error("evolution_not_configured");
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  const publicBase = process.env.MYCHATCRM_PUBLIC_BASE_URL?.trim() || process.env.AGENT_TEST_LAB_PUBLIC_URL?.trim();
  if (!webhookSecret) throw new Error("evolution_webhook_secret_missing");
  if (!publicBase || new URL(publicBase).protocol !== "https:") throw new Error("lab_webhook_url_missing");

  const sb = createSupabaseServiceClient();
  let row = await getLabReceiverRow();
  const activeRuns = await sb.from("agent_test_lab_runs").select("id", { count: "exact", head: true })
    .eq("owner_admin_id", LAB_OWNER_ID).not("status", "in", "(completed,failed,cancelled)");
  if (activeRuns.error || activeRuns.count !== 0) throw new Error("receiver_has_active_runs");
  if (row) {
    const routing = await inspectLabReceiver();
    if (routing?.labTenantId !== labTenantIdFor(sourceTenantId, sourceAgentId) || routing.labAgentId !== `lab-${sourceAgentId}`.slice(0, 100)) {
      throw new Error("receiver_target_mismatch");
    }
  }
  const copy = await provisionLabIsolatedAgent(sourceTenantId, sourceAgentId);

  if (!row) {
    const id = randomUUID();
    const instanceName = `${LAB_RECEIVER_PREFIX}${id}`;
    await labAudit("receiver.connect_requested", id);
    const reserved = await sb.from("agent_test_lab_connections").insert({
      id, owner_admin_id: LAB_OWNER_ID, purpose: "receiver", instance_name: instanceName,
      webhook_secret_hash: labHash(webhookSecret), state: "provisioning",
    });
    if (reserved.error) throw new Error("receiver_reservation_failed");
    const created = await evolutionCreateInstance({
      instanceName, webhookUrl: buildEvolutionWebhookUrl(publicBase, webhookSecret),
      settings: { ...CLIENT_EVOLUTION_INSTANCE_SETTINGS },
    });
    if (!created.ok) throw new Error("receiver_creation_unconfirmed");
    // /instance/create does not always persist inline settings.
    await applyClientEvolutionInstanceSettings(instanceName);

    const routed = await sb.from("tenant_evolution_instances").upsert({
      tenant_id: copy.labTenantId, slot_index: 0, instance_name: instanceName,
      organic_agent_id: copy.labAgentId, default_agent_id: copy.labAgentId, connection_state: "connecting",
    }, { onConflict: "tenant_id,slot_index" }).select("id").single();
    if (routed.error || !routed.data) throw new Error("receiver_routing_failed");

    // Without an organic rule the intake is silent by design; the laboratory needs
    // its own so a real conversation reaches the copy and nothing else.
    // lead_distribution_rules is unique on id alone, so this is a read-then-write
    // rather than an upsert, and it stays scoped to the laboratory tenant.
    const existing = await sb.from("lead_distribution_rules").select("id")
      .eq("tenant_id", copy.labTenantId).eq("source", "whatsapp_organico").maybeSingle();
    if (existing.error) throw new Error("receiver_rule_read_failed");
    const ruleRow = {
      tenant_id: copy.labTenantId, name: "Laboratório — WhatsApp orgânico", source: "whatsapp_organico",
      distribution_type: "specific_agents", transport: "evolution", connection_id: String(routed.data.id),
      agent_ids: [copy.labAgentId], employee_ids: [], mappings: [], active: true, order_index: 1,
      created_by: LAB_OWNER_ID,
    };
    const rule = existing.data
      ? await sb.from("lead_distribution_rules").update(ruleRow).eq("id", existing.data.id).eq("tenant_id", copy.labTenantId)
      : await sb.from("lead_distribution_rules").insert(ruleRow);
    if (rule.error) throw new Error("receiver_rule_failed");
    row = await getLabReceiverRow();
  }

  const refreshed = await refreshReceiver();
  if (!refreshed || refreshed.state === "absent") throw new Error("receiver_missing_review_required");
  if (refreshed.state === "conflict") throw new Error("receiver_number_already_in_use");
  if (refreshed.state === "open") return { connection: await inspectLabReceiver(), qr: null, copy };

  const qrResult = await evolutionInstanceConnect(refreshed.instance_name);
  if (!qrResult.ok) throw new Error("receiver_qr_unavailable");
  const qr = normalizeInstanceConnectToQrDataUrl(qrResult.data);
  if (!qr || !/^data:image\/(png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(qr)) throw new Error("receiver_qr_unavailable");
  return { connection: await inspectLabReceiver(), qr, copy };
}

export async function refreshLabReceiver() {
  await refreshReceiver();
  return inspectLabReceiver();
}

/** Removes only the laboratory's own answering line and its routing. */
export async function disconnectLabReceiver() {
  const row = await getLabReceiverRow();
  if (!row) return;
  const sb = createSupabaseServiceClient();
  const runs = await sb.from("agent_test_lab_runs").select("id", { count: "exact", head: true })
    .not("status", "in", "(completed,failed,cancelled)");
  if (runs.error || runs.count !== 0) throw new Error("receiver_has_active_runs");
  await labAudit("receiver.disconnect_requested", row.id);
  await evolutionLogoutInstance(row.instance_name);
  await evolutionDeleteInstance(row.instance_name);
  const inventory = await evolutionFetchInstances(row.instance_name);
  if (!inventory.ok || inventory.data.some(item => item.name === row.instance_name)) throw new Error("receiver_removal_unconfirmed");
  const routing = await sb.from("tenant_evolution_instances").delete().eq("instance_name", row.instance_name);
  if (routing.error) throw new Error("receiver_routing_cleanup_failed");
  const archived = await sb.from("agent_test_lab_connections")
    .update({ state: "disconnected", archived_at: new Date().toISOString() }).eq("id", row.id);
  if (archived.error) throw new Error("receiver_archive_failed");
}
