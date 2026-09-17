import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  evolutionCreateInstance, evolutionFetchInstances, evolutionInstanceConnect,
  evolutionRemoveInstanceCompletely, evolutionLogoutInstance, isEvolutionApiConfigured,
  applyClientEvolutionInstanceSettings, CLIENT_EVOLUTION_INSTANCE_SETTINGS,
} from "@/lib/integrations/evolution-api";
import { buildEvolutionWebhookUrl } from "@/lib/integrations/evolution-webhook-url";
import { normalizeInstanceConnectToQrDataUrl } from "@/lib/integrations/evolution-connect-qr";
import { checkWhatsAppCloudConnectionHealth } from "@/lib/integrations/whatsapp-cloud";
import { deleteWhatsAppCloudConnection, upsertWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";
import { setSlotActiveProvider } from "@/lib/server/whatsapp-slot-provider";
import { LAB_OWNER_ID, labMaskedJid, labPhoneJid } from "@/lib/agent-test-lab/policy";
import { labAudit, labHash } from "./auth";
import { assertNoOpenLabRuns } from "./connections";
import { provisionLabIsolatedAgent, labTenantIdFor } from "./isolation";
import type { LabMetaCredentials } from "./meta-onboarding";

export const LAB_RECEIVER_PREFIX = "mychatcrm-lab-receiver-";
export const LAB_META_RECEIVER_PREFIX = "mychatcrm-lab-meta-receiver-";
const LAB_QR_IMAGE = /^data:image\/(png|jpeg);base64,[a-z0-9+/=\s]+$/i;
function labQr(payload: unknown): string | null {
  const qr = normalizeInstanceConnectToQrDataUrl(payload);
  return qr && LAB_QR_IMAGE.test(qr) ? qr : null;
}

async function getLabReceiverRow() {
  const result = await createSupabaseServiceClient().from("agent_test_lab_connections")
    .select("id,instance_name,provider,state,wa_jid,webhook_secret_hash,phone_number_id,waba_id,access_token,display_phone,verified_name,webhook_subscribed,phone_registered,updated_at")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "receiver").is("archived_at", null).maybeSingle();
  if (result.error) throw new Error("receiver_read_failed");
  if (result.data && !result.data.instance_name.startsWith(
    result.data.provider === "meta_cloud" ? LAB_META_RECEIVER_PREFIX : LAB_RECEIVER_PREFIX,
  )) throw new Error("receiver_identity_invalid");
  return result.data;
}

export async function inspectLabReceiver() {
  const row = await getLabReceiverRow();
  if (!row) return null;
  const sb = createSupabaseServiceClient();
  const routed = row.provider === "meta_cloud"
    ? await sb.from("whatsapp_cloud_connections").select("phone_number_id,tenant_id")
      .eq("phone_number_id", row.phone_number_id ?? "").maybeSingle()
    : await sb.from("tenant_evolution_instances").select("id,tenant_id,organic_agent_id")
      .eq("instance_name", row.instance_name).maybeSingle();
  if (routed.error) throw new Error("receiver_routing_read_failed");
  const route = routed.data as Record<string, unknown> | null;
  const labTenantId = typeof route?.tenant_id === "string" ? route.tenant_id : null;
  const isolated = labTenantId
    ? await sb.from("agent_test_lab_isolated_agents").select("lab_agent_id")
      .eq("owner_admin_id", LAB_OWNER_ID).eq("lab_tenant_id", labTenantId).is("archived_at", null).maybeSingle()
    : { data: null, error: null };
  if (isolated.error) throw new Error("receiver_routing_read_failed");
  return {
    id: row.id, provider: row.provider, state: row.state, number: labMaskedJid(row.wa_jid), updatedAt: row.updated_at,
    labTenantId, labAgentId: row.provider === "meta_cloud" ? isolated.data?.lab_agent_id ?? null : route?.organic_agent_id ?? null,
    connectionId: row.provider === "meta_cloud" ? route?.phone_number_id ?? null : route?.id ?? null,
  };
}

async function refreshReceiver() {
  const row = await getLabReceiverRow();
  if (!row) return null;
  if (row.provider === "meta_cloud") {
    if (!row.phone_number_id || !row.access_token) throw new Error("receiver_identity_invalid");
    const health = await checkWhatsAppCloudConnectionHealth({ phoneNumberId: row.phone_number_id, accessToken: row.access_token });
    const jid = health.ok ? labPhoneJid(health.displayPhoneNumber ?? row.display_phone) : null;
    let state = health.ok && jid && row.webhook_subscribed && row.phone_registered ? "open" : "action_required";
    const sb = createSupabaseServiceClient();
    if (state === "open" && jid) {
      const [foreign, tester] = await Promise.all([
        sb.from("whatsapp_cloud_connections").select("tenant_id").eq("phone_number_id", row.phone_number_id).eq("active", true),
        sb.from("agent_test_lab_connections").select("id").eq("owner_admin_id", LAB_OWNER_ID)
          .eq("purpose", "sender").eq("wa_jid", jid).is("archived_at", null).maybeSingle(),
      ]);
      if (foreign.error || tester.error) throw new Error("receiver_isolation_unconfirmed");
      if ((foreign.data ?? []).some(item => !String(item.tenant_id).startsWith("tenant-lab-")) || tester.data) {
        state = "conflict";
        await labAudit(tester.data ? "receiver.same_as_tester" : "receiver.number_collision", row.id, "blocked");
      }
    }
    const saved = await sb.from("agent_test_lab_connections").update({
      state,
      wa_jid: state === "conflict" ? null : jid,
      display_phone: health.ok ? health.displayPhoneNumber : row.display_phone,
      verified_name: health.ok ? health.verifiedName : row.verified_name,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).is("archived_at", null);
    if (saved.error) throw new Error("receiver_update_failed");
    return { ...row, state, wa_jid: state === "conflict" ? null : jid };
  }
  const result = await evolutionFetchInstances(row.instance_name);
  if (!result.ok && result.status !== 404) throw new Error("receiver_provider_unavailable");
  const exact = result.ok ? result.data.find(item => item.name === row.instance_name) : undefined;
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
  if (row?.provider === "meta_cloud") throw new Error("receiver_other_provider_connected");
  const activeRuns = await sb.from("agent_test_lab_runs").select("id", { count: "exact", head: true })
    .eq("owner_admin_id", LAB_OWNER_ID).not("status", "in", "(completed,failed,cancelled)");
  if (activeRuns.error || activeRuns.count !== 0) throw new Error("receiver_has_active_runs");
  if (row) {
    const routing = await inspectLabReceiver();
    if (routing?.labTenantId !== labTenantIdFor(sourceTenantId, sourceAgentId) || routing.labAgentId !== `lab-${sourceAgentId}`.slice(0, 100)) {
      throw new Error("receiver_target_mismatch");
    }
  }
  if (row) {
    const refreshed = await refreshReceiver();
    if (refreshed?.state === "absent") {
      await disconnectLabReceiver();
      row = null;
    }
  }
  const copy = await provisionLabIsolatedAgent(sourceTenantId, sourceAgentId);
  let createQr: string | null = null;

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
    createQr = labQr(created.data);
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
    if (!createQr) {
      const initialConnect = await evolutionInstanceConnect(instanceName);
      if (initialConnect.ok) createQr = labQr(initialConnect.data);
    }
  }

  if (createQr && row) {
    const saved = await sb.from("agent_test_lab_connections")
      .update({ state: "connecting", updated_at: new Date().toISOString() }).eq("id", row.id).is("archived_at", null);
    if (saved.error) throw new Error("receiver_update_failed");
    return { connection: await inspectLabReceiver(), qr: createQr, copy };
  }

  const refreshed = await refreshReceiver();
  if (!refreshed || refreshed.state === "absent") throw new Error("receiver_missing_review_required");
  if (refreshed.state === "conflict") throw new Error("receiver_number_already_in_use");
  if (refreshed.state === "open") return { connection: await inspectLabReceiver(), qr: null, copy };

  const qrResult = await evolutionInstanceConnect(refreshed.instance_name);
  if (!qrResult.ok) throw new Error("receiver_qr_unavailable");
  const qr = labQr(qrResult.data);
  if (!qr) throw new Error("receiver_qr_unavailable");
  return { connection: await inspectLabReceiver(), qr, copy };
}

export async function connectLabMetaReceiver(
  sourceTenantId: string,
  sourceAgentId: string,
  credentials: LabMetaCredentials,
) {
  const sb = createSupabaseServiceClient();
  let row = await getLabReceiverRow();
  if (row && row.provider !== "meta_cloud") throw new Error("receiver_other_provider_connected");
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
  const jid = labPhoneJid(credentials.displayPhone);
  if (!jid) throw new Error("meta_number_verification_failed");
  const [foreign, tester] = await Promise.all([
    sb.from("whatsapp_cloud_connections").select("tenant_id").eq("phone_number_id", credentials.phoneNumberId).eq("active", true),
    sb.from("agent_test_lab_connections").select("id").eq("owner_admin_id", LAB_OWNER_ID)
      .eq("purpose", "sender").eq("wa_jid", jid).is("archived_at", null).maybeSingle(),
  ]);
  if (foreign.error || tester.error) throw new Error("receiver_isolation_unconfirmed");
  if ((foreign.data ?? []).some(item => item.tenant_id !== copy.labTenantId) || tester.data) {
    throw new Error("receiver_number_already_in_use");
  }

  const cloud = await upsertWhatsAppCloudConnection({
    tenantId: copy.labTenantId,
    slotIndex: 0,
    phoneNumberId: credentials.phoneNumberId,
    wabaId: credentials.wabaId,
    accessToken: credentials.accessToken,
    displayPhone: credentials.displayPhone,
    verifiedName: credentials.verifiedName,
  });
  if (cloud.error) throw new Error("receiver_routing_failed");
  await setSlotActiveProvider(copy.labTenantId, 0, "cloud_api");

  const id = row?.id ?? randomUUID();
  const values = {
    owner_admin_id: LAB_OWNER_ID,
    purpose: "receiver",
    instance_name: `${LAB_META_RECEIVER_PREFIX}${id}`,
    provider: "meta_cloud",
    state: "open",
    wa_jid: jid,
    webhook_secret_hash: row?.webhook_secret_hash ?? labHash(randomUUID()),
    phone_number_id: credentials.phoneNumberId,
    waba_id: credentials.wabaId,
    access_token: credentials.accessToken,
    display_phone: credentials.displayPhone,
    verified_name: credentials.verifiedName,
    webhook_subscribed: credentials.webhookSubscribed,
    phone_registered: credentials.phoneRegistered,
    updated_at: new Date().toISOString(),
  };
  const reserved = row
    ? await sb.from("agent_test_lab_connections").update(values).eq("id", id).is("archived_at", null)
    : await sb.from("agent_test_lab_connections").insert({ id, ...values });
  if (reserved.error) {
    if (!row) await deleteWhatsAppCloudConnection(copy.labTenantId, 0);
    throw new Error("receiver_reservation_failed");
  }

  const existing = await sb.from("lead_distribution_rules").select("id")
    .eq("tenant_id", copy.labTenantId).eq("source", "whatsapp_organico").maybeSingle();
  if (existing.error) throw new Error("receiver_rule_read_failed");
  const ruleRow = {
    tenant_id: copy.labTenantId,
    name: "Laboratório — WhatsApp orgânico",
    source: "whatsapp_organico",
    distribution_type: "specific_agents",
    transport: "cloud_api",
    connection_id: credentials.phoneNumberId,
    agent_ids: [copy.labAgentId],
    employee_ids: [], mappings: [], active: true, order_index: 1, created_by: LAB_OWNER_ID,
  };
  const rule = existing.data
    ? await sb.from("lead_distribution_rules").update(ruleRow).eq("id", existing.data.id).eq("tenant_id", copy.labTenantId)
    : await sb.from("lead_distribution_rules").insert(ruleRow);
  if (rule.error) throw new Error("receiver_rule_failed");
  await labAudit("receiver.meta_connect_requested", id);
  await refreshReceiver();
  return { connection: await inspectLabReceiver(), qr: null, copy };
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
  const existingRoute = await inspectLabReceiver();
  if (row.provider === "meta_cloud") {
    if (existingRoute?.labTenantId) await deleteWhatsAppCloudConnection(existingRoute.labTenantId, 0);
  } else {
    const removal = await evolutionRemoveInstanceCompletely(row.instance_name);
    if (!removal.verifiedAbsent) throw new Error("receiver_removal_unconfirmed");
    const routing = await sb.from("tenant_evolution_instances").delete().eq("instance_name", row.instance_name);
    if (routing.error) throw new Error("receiver_routing_cleanup_failed");
  }
  if (existingRoute?.labTenantId) {
    const rules = await sb.from("lead_distribution_rules").delete()
      .eq("tenant_id", existingRoute.labTenantId).eq("source", "whatsapp_organico");
    if (rules.error) throw new Error("receiver_routing_cleanup_failed");
  }
  const archived = await sb.from("agent_test_lab_connections")
    .update({ state: "disconnected", access_token: null, archived_at: new Date().toISOString() }).eq("id", row.id);
  if (archived.error) throw new Error("receiver_archive_failed");
}

/**
 * Moves the answering line to the other provider, mirroring the tester swap.
 * Only the laboratory's own receiver link and its laboratory-tenant routing are
 * touched; a customer's connection with the same provider is never removed.
 */
export async function switchLabReceiverProvider(
  target: "evolution" | "meta_cloud",
  sourceTenantId: string,
  sourceAgentId: string,
) {
  const row = await getLabReceiverRow();
  if (row && row.provider === target) {
    return { switched: false, connection: await inspectLabReceiver(), qr: null, copy: null };
  }
  if (row) {
    await assertNoOpenLabRuns("receiver_has_active_runs");
    await labAudit("receiver.provider_switch_requested", row.id);
    await disconnectLabReceiver();
    if (await getLabReceiverRow()) throw new Error("receiver_switch_unconfirmed");
    await labAudit("receiver.provider_switched", row.id);
  }
  if (target === "evolution") return { switched: true, ...(await connectLabReceiver(sourceTenantId, sourceAgentId)) };
  return { switched: true, connection: null, qr: null, copy: null };
}
