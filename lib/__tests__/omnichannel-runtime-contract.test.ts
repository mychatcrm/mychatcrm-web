import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("omnichannel runtime contracts", () => {
  it("commits shared lead attribution only after the journey wins", () => {
    const content = source("lib/server/meta-lead-ingest.ts");
    const activation = content.indexOf("const journey = await activateLeadJourney");
    const conflictGate = content.indexOf(
      "if (journeyIsolationEnabled && (!journey || journey.status !== \"active\"))",
      activation,
    );
    const attributionCommit = content.indexOf("crm_attribution_committed", conflictGate);

    expect(activation).toBeGreaterThan(0);
    expect(conflictGate).toBeGreaterThan(activation);
    expect(attributionCommit).toBeGreaterThan(conflictGate);
    expect(content).toContain("deferJourneyAttribution");
  });

  it("resolves Cloud API tenants from rules instead of a global default tenant", () => {
    // The actual payload handling lives in the shared handler (reused by both
    // /api/webhooks/whatsapp and /api/webhooks/meta — see
    // lib/server/whatsapp-cloud-webhook-handler.ts), not in the route itself.
    const content = source("lib/server/whatsapp-cloud-webhook-handler.ts");

    expect(content).toContain("resolveCloudApiTenantByConnection");
    expect(content).not.toContain("WHATSAPP_DEFAULT_TENANT_ID");
  });

  it("routes Meta and Evolution through the same durable burst processor", () => {
    const metaWebhook = source("lib/server/whatsapp-cloud-webhook-handler.ts");
    const evolutionWebhook = source("app/api/webhooks/evolution/route.ts");
    const dispatcher = source("lib/server/agent-response-job-dispatcher.ts");
    const burst = source("lib/conversas/normalize-conversation-burst.ts");

    expect(metaWebhook).toContain("runInboundSmartWaitFlow");
    expect(metaWebhook).toContain('channel: "meta_cloud"');
    expect(evolutionWebhook).toContain('channel: "evolution"');
    expect(evolutionWebhook).toContain("connectionId: row.id");
    expect(metaWebhook).not.toContain("generateAgentResponse");
    expect(dispatcher).toContain("processMetaAgentResponseJob");
    expect(dispatcher).toContain("processEvolutionAgentResponseJob");
    expect(burst).toContain("messages.length > 0 ? [messages] : []");
  });

  it("uses the additive sliding-silence RPC and sends one unquoted Evolution reply", () => {
    const jobs = source("lib/server/agent-response-jobs.ts");
    const evolutionReply = source("lib/server/evolution-agent-reply.ts");
    const migration = source(
      "supabase/migrations/20260722171818_agent_single_consolidated_turn_v4.sql",
    );

    expect(jobs).toContain('rpc("upsert_agent_response_job_burst_v4"');
    expect(jobs).toContain('return "rescheduled"');
    expect(jobs).toContain('logJobEvent("dispatch_rescheduled"');
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.upsert_agent_response_job_burst_v4");
    expect(migration).toContain(
      "v_scheduled_for := v_last_at + make_interval(secs => GREATEST(p_followup_seconds, 65))",
    );
    expect(migration).toContain(
      "v_scheduled_for := p_received_at + make_interval(secs => GREATEST(p_initial_seconds, 65))",
    );
    expect(migration.indexOf("Provider retries are true no-ops")).toBeLessThan(
      migration.indexOf("INSERT INTO public.conversation_states"),
    );
    expect(migration).toContain("OR v_job.agent_id IS DISTINCT FROM p_agent_id");
    expect(migration).toContain("OR v_job.instance_name IS DISTINCT FROM p_instance_name");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.upsert_agent_response_job_burst_v4");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(evolutionReply).toContain("const unit = burst.canonicalMessages");
    expect(evolutionReply).not.toContain("for (let unitIndex = 0; unitIndex < burst.replyUnits.length");
    expect(evolutionReply).not.toContain("quoted,");
  });

  it("rejects live response jobs without an exact connection and cancels only audited legacy jobs", () => {
    const migration = source(
      "supabase/migrations/20260721200614_evolution_agent_connection_hotfix.sql",
    );

    expect(migration).toContain("agent_job_connection_required");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF connection_id, status");
    expect(migration).toContain("connection_missing_legacy_cancelled");
    expect(migration).toContain("outbox.authorization_reason = 'connection_missing'");
    expect(migration).not.toContain("DELETE FROM public.agent_response_jobs");
  });

  it("acknowledges Evolution webhooks before waiting for the agent response", () => {
    const webhook = source("app/api/webhooks/evolution/route.ts");
    const flow = source("lib/server/evolution-webhook-agent-flow.ts");
    const jobs = source("lib/server/agent-response-jobs.ts");
    const dispatch = source("app/api/internal/agent-response-jobs/dispatch/route.ts");

    expect(webhook).toContain('import { waitUntil } from "@vercel/functions"');
    expect(webhook).toContain('const DEFERRED_EVOLUTION_HEADER = "x-mychatcrm-evolution-deferred"');
    expect(webhook).toContain("if (!trustedDeferredRequest)");
    expect(webhook).toContain("...internalApiAuthHeaders()");
    expect(webhook).toContain("waitUntil(deferredTask)");
    expect(webhook).not.toContain("token=EVOLUTION_WEBHOOK_SECRET&deferred");
    expect(webhook).toContain("const automationTask = Promise.all(");
    expect(webhook).toContain("waitUntil(\n      automationTask.then(() => undefined)");
    expect(webhook).toContain("deferProcessor:");
    expect(webhook).toContain("waitUntil(task.then(() => undefined))");
    expect(webhook).toContain("evolutionBurstSafeSmartWait(");
    expect(flow).toContain("params.deferProcessor(processorTask)");
    expect(flow).toContain("await processorTask");
    expect(flow).not.toContain("waitAndProcessAgentResponseJob");
    expect(webhook).toContain("processorBaseUrl: new URL(request.url).origin");
    expect(jobs).toContain('new URL("/api/internal/agent-response-jobs/dispatch", base)');
    expect(jobs).toContain("signal: AbortSignal.timeout(8_000)");
    expect(dispatch).toContain('import { waitUntil } from "@vercel/functions"');
    expect(dispatch).toContain("processDispatchedJob(jobId)");
    expect(dispatch).toContain("export const maxDuration = 180");
    expect(dispatch).toContain("{ status: 202 }");
  });

  it("scopes direct WhatsApp rule conflicts to the same transport and connection", () => {
    for (const path of [
      "app/api/client/lead-rules/route.ts",
      "app/api/client/lead-rules/[id]/route.ts",
    ]) {
      const content = source(path);
      expect(content).toContain('.eq("transport", transport)');
      expect(content).toContain('.eq("connection_id", connectionId)');
    }
  });

  it("persists campaign messages as pending before calling Evolution or the Meta template API", () => {
    const content = source("lib/server/whatsapp-campaigns.ts");
    const pendingInsert = content.indexOf('delivery_status: "pending"');
    const send = content.indexOf("const delivery =", pendingInsert);
    const evolutionSend = content.indexOf("await evolutionSendText(", pendingInsert);
    const metaSend = content.indexOf("await sendWhatsAppTemplateMessage(", pendingInsert);

    expect(pendingInsert).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(pendingInsert);
    expect(evolutionSend).toBeGreaterThan(send);
    expect(metaSend).toBeGreaterThan(send);
    expect(content).toContain("messageInsertError");
    expect(content).toContain('delivery_status: "failed"');
    expect(content).toContain('delivery_status: "sent"');
  });

  it("uses the canonical journey feature flag in the shared processor", () => {
    const content = source("app/api/internal/process-follow-ups/route.ts");

    expect(content).toContain("if (isJourneyIsolationEnabled())");
    expect(content).not.toContain('OMNICHANNEL_JOURNEYS_ENABLED === "true"');
  });

  it("loads the latest CRM messages and restores chronological display order", () => {
    const content = source("lib/server/lead-chatbot-history.ts");

    expect(content).toContain('.order("created_at", { ascending: false })');
    expect(content).toContain(".reverse()");
  });

  it("skips Phase 2 automation for the system agent's own tenant, so it never auto-replies over Evolution/QR", () => {
    // The system agent is notification-only — Phase 1 (message persistence,
    // for "Conversas ao vivo") must still run, but Phase 2 (AI reply
    // generation) must bail out before ever calling generateAgentResponse.
    const content = source("app/api/webhooks/evolution/route.ts");
    const phase2Start = content.indexOf("// ── Phase 2: run automation flows after the ACK path");
    const guard = content.indexOf("if (row.tenant_id === SYSTEM_TENANT_ID) return;", phase2Start);
    const generateCall = content.indexOf("await generateAgentResponse({", phase2Start);

    expect(phase2Start).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(phase2Start);
    expect(generateCall).toBeGreaterThan(guard);
  });

  it("only fires the WhatsApp 'connected' alert with a fresh, confirmed live session", () => {
    // Regression: Evolution's connectionState endpoint can report "open" for a
    // zombie/already-closed instance, and the existing zombie-check doesn't
    // always correct it (e.g. if fetchInstances itself fails). Trusting
    // remoteState === "open" alone sent a false "you just connected" alert for
    // an instance that had actually been disconnected hours earlier.

    // Webhook path: requires a fresh/confirmed waJid before notifying connect.
    const webhookSource = source("app/api/webhooks/evolution/route.ts");
    const webhookConnectBlock = webhookSource.indexOf("notifyTenantIntegrationConnected({");
    const webhookGuardStart = webhookSource.lastIndexOf("if (", webhookConnectBlock);
    const webhookGuard = webhookSource.slice(webhookGuardStart, webhookConnectBlock);
    expect(webhookGuard).toContain("confirmedWaJid &&");
    expect(webhookSource.slice(webhookConnectBlock, webhookConnectBlock + 500)).toContain("confirmedWaJid,");

    // Client status-poll path: requires the zombie-check to have freshly
    // confirmed an ownerJid THIS poll cycle, not a stale cached wa_jid.
    const pollSource = source("app/api/client/whatsapp/evolution/session/route.ts");
    const ownerJidConfirmedDeclared = pollSource.indexOf("let ownerJidConfirmedThisPoll = false;");
    const ownerJidConfirmedSet = pollSource.indexOf("ownerJidConfirmedThisPoll = true;", ownerJidConfirmedDeclared);
    const pollConnectBlock = pollSource.indexOf("notifyTenantIntegrationConnected({");
    const pollGuardStart = pollSource.lastIndexOf("if (", pollConnectBlock);
    const pollGuard = pollSource.slice(pollGuardStart, pollConnectBlock);

    expect(ownerJidConfirmedDeclared).toBeGreaterThan(0);
    expect(ownerJidConfirmedSet).toBeGreaterThan(ownerJidConfirmedDeclared);
    expect(pollGuard).toContain("ownerJidConfirmedThisPoll &&");
  });

  it("keeps the system agent's Evolution purge unable to touch client instances", () => {
    // The system prefix must be the FULL deterministic instance name (mc + 28
    // hex chars of the tenant+slot hash) — a client instance is mc + its own
    // 28-hex hash, so startsWith(full prefix) can only match system instances.
    // If a refactor ever shortened this prefix (e.g. to just "mc"), the system
    // agent's purge/reset would start deleting CLIENT WhatsApp sessions.
    const systemAgentSource = source("lib/server/system-agent.ts");
    const prefixFn = systemAgentSource.indexOf("export function getSystemEvolutionInstancePrefix()");
    const prefixBody = systemAgentSource.slice(prefixFn, prefixFn + 200);
    expect(prefixFn).toBeGreaterThan(0);
    expect(prefixBody).toContain("buildEvolutionInstanceName(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX)");

    const evolutionApiSource = source("lib/integrations/evolution-api.ts");
    const buildFn = evolutionApiSource.indexOf("export function buildEvolutionInstanceName");
    const buildBody = evolutionApiSource.slice(buildFn, buildFn + 300);
    expect(buildBody).toContain('.slice(0, 28)');
    expect(buildBody).toContain("`mc${h}`");
  });

  it("resolves tenant for Evolution inbound and the SYSTEM_TENANT_ID guards from the same instance row", () => {
    // Both the "should the system agent skip auto-reply" guards and the AI
    // routing must derive from the SAME getEvolutionInstanceByName lookup —
    // two independent resolution paths could disagree and leak behavior
    // across the system/client boundary.
    const content = source("app/api/webhooks/evolution/route.ts");
    const rowLookup = content.indexOf("row = await getEvolutionInstanceByName(instanceName)");
    const metaActiveGuard = content.indexOf("row.tenant_id === SYSTEM_TENANT_ID && (await isMetaProviderActive())", rowLookup);
    const journeyRouting = content.indexOf("tenantId: row.tenant_id", rowLookup);
    const phase2Guard = content.indexOf("if (row.tenant_id === SYSTEM_TENANT_ID) return;", rowLookup);

    expect(rowLookup).toBeGreaterThan(0);
    expect(metaActiveGuard).toBeGreaterThan(rowLookup);
    expect(journeyRouting).toBeGreaterThan(rowLookup);
    expect(phase2Guard).toBeGreaterThan(rowLookup);
  });

  it("keeps session polling read-only and never masks a live non-open state", () => {
    // Regression: a tenant got a false "your WhatsApp disconnected" alert while it was
    // still connected. Evolution/Baileys can report a transient non-"open" state during
    // an automatic reconnect blip, and neither the webhook nor the poll route had any
    // corroborating check before firing the disconnect alert (unlike the connect side,
    // which already required a fresh ownerJid). This locks in the symmetric fix.

    // Webhook path: re-checks fetchInstances before accepting open -> non-open.
    const webhookSource = source("app/api/webhooks/evolution/route.ts");
    const webhookFetchInstancesIdx = webhookSource.indexOf("evolutionFetchInstances(instanceName)");
    const webhookDisconnectBlock = webhookSource.indexOf("notifyTenantIntegrationDisconnected({");
    expect(webhookFetchInstancesIdx).toBeGreaterThan(0);
    expect(webhookFetchInstancesIdx).toBeLessThan(webhookDisconnectBlock);
    expect(webhookSource.slice(0, webhookDisconnectBlock)).toContain("confirmedState");

    // Client status-poll path must not turn a live `connecting` state back into
    // `open` from stale inventory, nor call /instance/connect on every poll.
    const pollSource = source("app/api/client/whatsapp/evolution/session/route.ts");
    const getHandler = pollSource.slice(
      pollSource.indexOf("export async function GET"),
      pollSource.indexOf("export async function DELETE"),
    );
    expect(getHandler).not.toContain("evolutionInstanceConnect(");
    expect(getHandler).not.toContain("Reverse zombie check");
    expect(getHandler).toContain("GET e polling são estritamente passivos");
  });
});
