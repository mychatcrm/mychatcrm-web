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

  it("sends conventional follow-ups through the journey connection", () => {
    const followUps = source("lib/server/follow-up-jobs.ts");

    expect(followUps).toContain("getEvolutionInstanceByIdForTenant");
    expect(followUps).toContain("connectionId: isHumanAbandonedJob ? undefined");
    expect(followUps).toContain("missing_authorized_connection");
    expect(followUps).toContain("authorized_connection_not_open");
    expect(followUps).toContain(": await getEvolutionInstanceByTenantId(job.tenant_id)");
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
