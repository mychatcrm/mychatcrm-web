import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("omnichannel production hardening", () => {
  it("suppresses automatic fallback replies when an agent has no instructions", () => {
    for (const path of [
      "lib/server/meta-lead-ingest.ts",
      "lib/server/meta-lead-manual-assignment.ts",
      "app/api/webhooks/evolution/route.ts",
      "lib/server/meta-agent-reply.ts",
      "lib/server/evolution-agent-reply.ts",
      "lib/server/follow-up-jobs.ts",
    ]) {
      expect(source(path), path).toContain("isAgentMissingInstructionsResult");
      expect(source(path), path).toContain("agent_missing_instructions");
    }
  });

  it("returns a retryable error when Stripe fulfillment fails", () => {
    const webhook = source("app/api/webhooks/stripe/route.ts");
    const catchBlock = webhook.slice(webhook.lastIndexOf("} catch (err)"));

    expect(catchBlock).toContain("status: 500");
    expect(catchBlock).not.toContain("received: true");
  });

  it("admits new campaign recipients through quota before creating a CRM lead", () => {
    const campaign = source("lib/server/whatsapp-campaigns.ts");
    const reserve = campaign.indexOf("await reserveTenantLeadQuota");
    const insert = campaign.indexOf('.from("leads")\n    .insert(payload)', reserve);

    expect(reserve).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(reserve);
    expect(campaign).toContain('source: "whatsapp_campaign"');
    expect(campaign).toContain('"blocked_lead_quota_exhausted"');
    expect(campaign).toContain("commitTenantLeadQuotaReservation");
    expect(campaign).toContain("releaseTenantLeadQuotaReservation");
  });

  it("never assigns the first connection to an ambiguous legacy Meta rule", () => {
    const migration = source(
      "supabase/migrations/20260710105234_omnichannel_connection_backfill_hardening.sql",
    );

    expect(migration).toContain("having count(*) = 1");
    expect(migration).toContain("missing_or_ambiguous_meta_rule_connection");
    expect(migration).toContain("status = 'manual_review'");
    expect(migration).not.toContain("order by tei.slot_index");
  });

  it("requires an explicit connection for Meta and organic automation", () => {
    const meta = source("lib/server/meta-form-authorization.ts");
    const createRule = source("app/api/client/lead-rules/route.ts");
    const updateRule = source("app/api/client/lead-rules/[id]/route.ts");

    expect(meta).toContain("Boolean(rule.connection_id?.trim())");
    expect(createRule).toContain("organic agent sync skipped without explicit connection");
    expect(updateRule).toContain("organic agent sync skipped without explicit connection");
  });

  it("uses the form rule connection for manual Meta assignment", () => {
    const manualAssignment = source("lib/server/meta-lead-manual-assignment.ts");

    expect(manualAssignment).toContain("resolveAuthorizedMetaLeadAgent");
    expect(manualAssignment).toContain("preferredAgentId: agentId");
    expect(manualAssignment).toContain("resolveMetaLeadWhatsappConnection");
    expect(manualAssignment).toContain("sendMetaLeadInitialWhatsapp");
    expect(manualAssignment).not.toContain("getEvolutionInstanceByTenantId");
  });

  it("sends follow-ups through the exact journey connection on both providers", () => {
    const followUps = source("lib/server/follow-up-jobs.ts");

    expect(followUps).toContain("getEvolutionInstanceByIdForTenant");
    expect(followUps).toContain("lookupWhatsAppCloudConnectionByPhoneNumberId");
    expect(followUps).toContain("sendWhatsAppTextMessage");
    expect(followUps).toContain("connectionId: job.connection_id");
    expect(followUps).toContain("channel: job.channel");
    expect(followUps).toContain("channel: exactTransport.channel");
    expect(followUps).not.toContain("returnConversationToAutomation({");
    expect(followUps).toContain("prepareAutomatedOutbound({");
    expect(followUps).toContain("missing_authorized_connection");
    expect(followUps).toContain("authorized_connection_not_open");
    expect(followUps).not.toContain("getEvolutionInstanceByTenantId(job.tenant_id)");
    expect(followUps).toContain("reclaimStuckFollowUpJobs(client)");
    expect(followUps).not.toContain("localizedAgentFailureReply");
    expect(followUps).toContain("finish_follow_up_job_v2");
    expect(followUps).not.toContain(
      "Oi! Passando para saber se ainda posso te ajudar com algo. Fico à disposição.",
    );
  });

  it("keeps Meta reply parity for handoff, TTS, media and follow-up", () => {
    const metaReply = source("lib/server/meta-agent-reply.ts");
    const metaWebhook = source("lib/server/whatsapp-cloud-webhook-handler.ts");

    expect(metaReply).toContain("detectAgentHandoff");
    expect(metaReply).toContain("deliverAgentReplyWithOptionalTts");
    expect(metaReply).toContain("sendAgentOutboundMediaViaMeta");
    expect(metaReply).toContain("completeAgentHandoff");
    expect(metaWebhook).toContain("scheduleFollowUpAfterInbound");
    expect(metaWebhook).toContain('channel: "meta_cloud"');
    expect(metaWebhook).toContain("connectionId: inbound.phoneNumberId");
  });

  it("revalidates the exact journey connection before either provider calls the model", () => {
    for (const [path, channel] of [
      ["lib/server/evolution-agent-reply.ts", "evolution"],
      ["lib/server/meta-agent-reply.ts", "meta_cloud"],
    ] as const) {
      const content = source(path);
      const processor = content.indexOf("export async function process");
      const authorization = content.indexOf("await authorizeActiveJourney({", processor);
      const generation = content.indexOf(
        channel === "evolution" ? "await generateReplyForUnit({" : "await generateAgentResponse({",
        authorization,
      );

      expect(authorization, path).toBeGreaterThan(0);
      expect(generation, path).toBeGreaterThan(authorization);
      expect(content, path).toContain("connectionId: job.connection_id");
      expect(content, path).toContain(`channel: "${channel}"`);
    }
  });

  it("preserves the logical WhatsApp connection when a client disconnects", () => {
    const sessionRoute = source("app/api/client/whatsapp/evolution/session/route.ts");
    const lifecycle = source("lib/server/evolution-slot-lifecycle.ts");
    const deleteHandler = sessionRoute.slice(sessionRoute.indexOf("export async function DELETE"));

    expect(deleteHandler).toContain("removeEvolutionSlotSafely");
    expect(deleteHandler).toContain("connectionId: lifecycle.row.id");
    expect(lifecycle).toContain("finalizeTenantEvolutionInstanceRemoval");
    expect(deleteHandler).not.toContain("deleteTenantEvolutionInstanceRow");
  });

  it("does not auto-connect an existing non-open Evolution session from the UI", () => {
    const panel = source("components/dashboard/integrations/EvolutionQrSlotPanel.tsx");

    expect(panel).toContain('st === "none" && !hasQr');
    expect(panel).not.toContain('st === "none" || (!hasQr && st !== "open")');
    expect(panel).toContain("nextQrDataUrl ?? (sessionFinished ? null : current)");
  });
});
