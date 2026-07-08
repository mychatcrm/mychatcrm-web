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

  it("persists campaign messages as pending before calling Evolution", () => {
    const content = source("lib/server/whatsapp-campaigns.ts");
    const pendingInsert = content.indexOf('delivery_status: "pending"');
    const send = content.indexOf("const delivery = await evolutionSendText", pendingInsert);

    expect(pendingInsert).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(pendingInsert);
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
    const phase2Start = content.indexOf("// ── Phase 2: run automation flows in parallel");
    const guard = content.indexOf("if (row.tenant_id === SYSTEM_TENANT_ID) return;", phase2Start);
    const generateCall = content.indexOf("await generateAgentResponse({", phase2Start);

    expect(phase2Start).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(phase2Start);
    expect(generateCall).toBeGreaterThan(guard);
  });
});
