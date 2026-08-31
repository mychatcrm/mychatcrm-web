import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidAgentAgendaTimezone } from "@/lib/server/process-agent-turn-v2";
import { resolveAgentHandoffSettings } from "@/lib/server/agent-handoff-runtime";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("processAgentTurnV2 omnichannel contract", () => {
  it("is the runtime used by Evolution and Meta Cloud", () => {
    const dispatcher = source("lib/server/agent-response-job-dispatcher.ts");
    const evolution = source("lib/server/evolution-agent-adapter-v2.ts");
    const meta = source("lib/server/meta-agent-adapter-v2.ts");
    const evolutionCompatibility = source("lib/server/evolution-agent-reply.ts");
    const metaCompatibility = source("lib/server/meta-agent-reply.ts");

    expect(dispatcher).toContain("processEvolutionAgentResponseJob");
    expect(dispatcher).toContain("processMetaAgentResponseJob");
    expect(evolutionCompatibility).toContain("evolution-agent-adapter-v2");
    expect(metaCompatibility).toContain("meta-agent-adapter-v2");
    expect(evolutionCompatibility).toContain('AGENT_TURN_V2 !== "off"');
    expect(metaCompatibility).toContain('AGENT_TURN_V2 !== "off"');
    for (const adapter of [evolution, meta]) {
      expect(adapter).toContain("processAgentTurnV2({");
      expect(adapter).not.toContain("generateAgentResponse");
      expect(adapter).not.toContain("resolveAgendaTurn");
      expect(adapter).not.toContain("prepareAgentOutbound");
    }
    expect(evolution).toContain('channel: "evolution"');
    expect(meta).toContain('channel: "meta_cloud"');
    expect(meta).not.toContain("evolution-agent-adapter-v2");
  });

  it("keeps generation, one agenda resolution, revalidation, outbox and delivery ordered", () => {
    const engine = source("lib/server/process-agent-turn-v2.ts");
    const generation = engine.indexOf("const generated = await generateAgentResponse({");
    const agenda = engine.indexOf("const agendaTurn = await resolveAgendaTurn({");
    const finalJourney = engine.indexOf("const finalJourneyFailure", agenda);
    const outbox = engine.indexOf("const outbound = await prepareAgentOutbound({", finalJourney);
    const delivery = engine.indexOf("await transport.deliverPrimary({", outbox);

    expect(generation).toBeGreaterThan(0);
    expect(agenda).toBeGreaterThan(generation);
    expect(finalJourney).toBeGreaterThan(agenda);
    expect(outbox).toBeGreaterThan(finalJourney);
    expect(delivery).toBeGreaterThan(outbox);
    expect(engine.match(/await resolveAgendaTurn\(\{/g)).toHaveLength(1);
    expect(engine).toContain("isAgentConversationSequenceCurrent");
    expect(engine).toContain("automation_epoch");
  });

  it("uses the same engine in dry-run without agenda mutation or provider delivery", () => {
    const engine = source("lib/server/process-agent-turn-v2.ts");
    const simulation = source("app/api/client/agentes/[id]/simulate/route.ts");
    const dryRunBranch = engine.indexOf("if (dryRun) {");
    const agenda = engine.indexOf("const agendaTurn = await resolveAgendaTurn({");
    const outbox = engine.indexOf("const outbound = await prepareAgentOutbound({");

    expect(simulation).toContain("simulateAgentTurnV2({");
    expect(simulation).not.toContain("generateAgentResponse({");
    expect(dryRunBranch).toBeGreaterThan(0);
    expect(dryRunBranch).toBeGreaterThan(agenda);
    expect(dryRunBranch).toBeLessThan(outbox);
    expect(engine).toContain("createSimulationAgendaExecutionPort()");
    expect(engine).toContain("agendaDecision: agendaTurn.decision");
    expect(engine).toContain('"dry_run_no_business_mutations"');
    expect(engine).toContain("generated.externalApiLookupTrace");
    expect(simulation).toContain("result.decision.languageTag");
    expect(simulation).toContain("mutated: false");
    expect(simulation).toContain("outboundSent: false");
  });

  it("blocks only agenda for missing or invalid IANA timezones", () => {
    expect(isValidAgentAgendaTimezone("America/Sao_Paulo")).toBe(true);
    expect(isValidAgentAgendaTimezone("Asia/Tokyo")).toBe(true);
    expect(isValidAgentAgendaTimezone("UTC")).toBe(true);
    expect(isValidAgentAgendaTimezone("")).toBe(false);
    expect(isValidAgentAgendaTimezone("Sao Paulo")).toBe(false);

    const engine = source("lib/server/process-agent-turn-v2.ts");
    expect(engine).toContain('includes("agenda_timezone_required")');
    expect(engine).toContain("agendaAutomationEnabled: false");
    expect(engine.indexOf("const agendaTimezoneInvalid")).toBeLessThan(
      engine.indexOf("const generated = await generateAgentResponse({"),
    );
    expect(engine).toContain("!agendaTimezoneInvalid");
    expect(engine).toContain("agendaBlocked: agendaTimezoneInvalid");
  });

  it("keeps incomplete handoff configuration disabled", () => {
    expect(
      resolveAgentHandoffSettings({
        ctaHandoffAtivo: true,
        handoffMensagem: "Transfer",
        handoffNumero: "+12025550123",
        handoffKeywords: [],
      }).enabled,
    ).toBe(false);
    expect(
      resolveAgentHandoffSettings({
        ctaHandoffAtivo: true,
        handoffMensagem: "Transfer",
        handoffNumero: "+12025550123",
        handoffKeywords: ["configured criterion"],
      }).enabled,
    ).toBe(true);
    expect(
      resolveAgentHandoffSettings({
        ctaHandoffAtivo: true,
        handoffMensagem: "Transfer",
        handoffNumero: "+12025550123",
        handoffKeywords: ["x".repeat(201)],
      }).enabled,
    ).toBe(false);
  });

  it("isolates inbound rows by tenant, contact, provider and exact connection", () => {
    for (const path of [
      "lib/server/evolution-agent-adapter-v2.ts",
      "lib/server/meta-agent-adapter-v2.ts",
    ]) {
      const adapter = source(path);
      expect(adapter, path).toContain('.eq("tenant_id", job.tenant_id)');
      expect(adapter, path).toContain('.eq("remote_jid", job.remote_jid)');
      expect(adapter, path).toContain('.eq("connection_id", job.connection_id)');
    }
  });

  it("does not drop Meta Cloud media before the shared turn", () => {
    const webhook = source("lib/server/whatsapp-cloud-webhook-handler.ts");
    const meta = source("lib/server/meta-agent-adapter-v2.ts");

    expect(webhook).toContain("systemInbound ?? parseWhatsAppCloudInbound(json)");
    expect(webhook).toContain("fetchWhatsAppCloudMedia");
    expect(webhook).toContain("uploadMediaToR2");
    expect(webhook).toContain("kind: inbound.kind");
    expect(meta).toContain("enrichAgentInboundMediaV2(sb, inboundRows)");
    expect(meta).toContain("storage_key,mime_type,analysis_status,ai_description");
  });
});
