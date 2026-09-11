import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { evolutionCreateInstance, evolutionFetchInstances, evolutionInstanceConnect,
  evolutionDeleteInstance, evolutionLogoutInstance, isEvolutionApiConfigured } from "@/lib/integrations/evolution-api";
import { normalizeInstanceConnectToQrDataUrl } from "@/lib/integrations/evolution-connect-qr";
import { LAB_INSTANCE_PREFIX, LAB_OWNER_ID, labMaskedJid, labPhoneJid } from "@/lib/agent-test-lab/policy";
import { labAudit, labHash } from "./auth";

export async function getLabSender() {
  const result = await createSupabaseServiceClient().from("agent_test_lab_connections")
    .select("id,instance_name,state,wa_jid,created_at,updated_at")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "sender").is("archived_at", null).maybeSingle();
  if (result.error) throw new Error("sender_read_failed");
  if (result.data && !result.data.instance_name.startsWith(LAB_INSTANCE_PREFIX)) throw new Error("sender_identity_invalid");
  return result.data;
}
export async function inspectLabSender() {
  const sender = await getLabSender();
  return sender ? { id: sender.id, state: sender.state, number: labMaskedJid(sender.wa_jid), updatedAt: sender.updated_at } : null;
}
async function refreshSender() {
  const sender = await getLabSender();
  if (!sender) return null;
  const result = await evolutionFetchInstances(sender.instance_name);
  if (!result.ok) throw new Error("sender_provider_unavailable");
  // Never use pickEvolutionInstanceInfo's single-item fallback for lab identity.
  const exact = result.data.find(row => row.name === sender.instance_name);
  const jid = labPhoneJid(exact?.ownerJid);
  let state = exact?.connectionStatus === "open" && jid ? "open" : exact ? "connecting" : "absent";
  const sb = createSupabaseServiceClient();
  if (state === "open" && jid) {
    const collision = await sb.from("tenant_evolution_instances").select("id", { count: "exact", head: true }).eq("wa_jid", jid);
    if (collision.error) throw new Error("sender_isolation_unconfirmed");
    if (collision.count !== 0) {
      state = "conflict";
      await labAudit("sender.number_collision", sender.id, "blocked");
      // Disconnect only this laboratory link. Never alter the existing customer/system link.
      await evolutionLogoutInstance(sender.instance_name);
    }
  }
  const saved = await sb.from("agent_test_lab_connections")
    .update({ state, wa_jid: jid, updated_at: new Date().toISOString() }).eq("id", sender.id).is("archived_at", null);
  if (saved.error) throw new Error("sender_update_failed");
  return { ...sender, state, wa_jid: jid };
}
export async function connectLabSender() {
  if (!isEvolutionApiConfigured()) throw new Error("evolution_not_configured");
  let sender = await getLabSender();
  if (!sender) {
    const base = process.env.AGENT_TEST_LAB_PUBLIC_URL;
    if (!base || new URL(base).protocol !== "https:" || new URL(base).username || new URL(base).password) throw new Error("lab_webhook_url_missing");
    const id = randomUUID(), secret = randomBytes(32).toString("base64url");
    const instanceName = `${LAB_INSTANCE_PREFIX}${id}`;
    const webhook = new URL("/api/webhooks/agent-test-lab", base);
    webhook.searchParams.set("connection", id); webhook.searchParams.set("token", secret);
    await labAudit("sender.connect_requested", id);
    const reserved = await createSupabaseServiceClient().from("agent_test_lab_connections").insert({
      id, owner_admin_id: LAB_OWNER_ID, purpose: "sender", instance_name: instanceName,
      webhook_secret_hash: labHash(secret), state: "provisioning",
    });
    if (reserved.error) throw new Error("sender_reservation_failed");
    // Preserve the reservation after timeout; a retry cannot create another instance.
    const created = await evolutionCreateInstance({ instanceName, webhookUrl: webhook.toString(), settings: {
      // alwaysOnline matters here: without it Evolution holds a burst for around a
      // minute before delivering, which would make every agent turn look slow and
      // push honest tests towards a timeout. This is the laboratory's own line.
      syncFullHistory: false, groupsIgnore: true, readMessages: false, readStatus: false, alwaysOnline: true, rejectCall: true,
    } });
    if (!created.ok) throw new Error("sender_creation_unconfirmed");
    sender = await refreshSender();
  } else sender = await refreshSender();
  if (!sender || sender.state === "absent") throw new Error("sender_missing_review_required");
  if (sender.state === "conflict") throw new Error("sender_number_already_in_use");
  if (sender.state === "open") return { connection: await inspectLabSender(), qr: null };
  const qrResult = await evolutionInstanceConnect(sender.instance_name);
  if (!qrResult.ok) throw new Error("sender_qr_unavailable");
  const qr = normalizeInstanceConnectToQrDataUrl(qrResult.data);
  // Do not cause the browser to fetch an arbitrary remote QR URL.
  if (!qr || !/^data:image\/(png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(qr)) throw new Error("sender_qr_unavailable");
  return { connection: await inspectLabSender(), qr };
}
export async function refreshLabSender() {
  await refreshSender(); return inspectLabSender();
}
export async function disconnectLabSender() {
  const sender = await getLabSender();
  if (!sender) return;
  const sb = createSupabaseServiceClient();
  const runs = await sb.from("agent_test_lab_runs").select("id", { count: "exact", head: true })
    .eq("sender_connection_id", sender.id).not("status", "in", "(completed,failed,cancelled)");
  if (runs.error || runs.count !== 0) throw new Error("sender_has_active_runs");
  await labAudit("sender.disconnect_requested", sender.id);
  // Exact registered name only, no system-agent reset and no inventory sweep.
  await evolutionLogoutInstance(sender.instance_name);
  await evolutionDeleteInstance(sender.instance_name);
  const inventory = await evolutionFetchInstances(sender.instance_name);
  if (!inventory.ok || inventory.data.some(row => row.name === sender.instance_name)) throw new Error("sender_removal_unconfirmed");
  const saved = await sb.from("agent_test_lab_connections").update({ state: "disconnected", archived_at: new Date().toISOString() }).eq("id", sender.id);
  if (saved.error) throw new Error("sender_archive_failed");
}
