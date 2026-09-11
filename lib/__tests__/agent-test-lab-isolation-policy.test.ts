import { describe, expect, it } from "vitest";
import { buildLabIsolatedCopy, LAB_COPYABLE_AGENT_KEYS, LAB_WITHHELD_AGENT_KEYS } from "@/lib/agent-test-lab/isolation-policy";

describe("isolated laboratory copy", () => {
  it("never copies a credential, however the field is spelled", () => {
    const copy = buildLabIsolatedCopy({
      metadata: {
        promptIdentidade: "Atendente",
        meta_access_token: "EAAG-live-token",
        meta_waba_id: "123", meta_phone_number_id: "456", meta_display_phone: "+5511999999999",
      },
    });
    const serialized = JSON.stringify(copy.metadata);
    expect(serialized).not.toContain("EAAG-live-token");
    expect(serialized).not.toContain("456");
    expect(copy.metadata.promptIdentidade).toBe("Atendente");
  });

  it("withholds by default, so a newly invented secret is not copied", () => {
    // The guarantee that matters: an unknown key is dropped, not carried over.
    const copy = buildLabIsolatedCopy({ metadata: { some_future_api_secret: "s3cr3t", promptObjetivo: "Agendar" } });
    expect(copy.metadata).not.toHaveProperty("some_future_api_secret");
    expect(copy.withheld).toContain("some_future_api_secret");
    expect(copy.metadata.promptObjetivo).toBe("Agendar");
  });

  it("keeps the documented allowlist and blocklist from overlapping", () => {
    for (const key of Object.keys(LAB_WITHHELD_AGENT_KEYS)) {
      expect(LAB_COPYABLE_AGENT_KEYS as readonly string[]).not.toContain(key);
    }
  });

  it("does not carry a real person's handoff number into the laboratory", () => {
    const copy = buildLabIsolatedCopy({ metadata: { handoffNumero: "+5562999990000", handoffMensagem: "Um instante" } });
    expect(copy.metadata).not.toHaveProperty("handoffNumero");
    expect(copy.metadata.handoffMensagem).toBe("Um instante");
    expect(copy.unavailable.map(item => item.dependency)).toContain("handoff");
  });

  it("reports a missing dependency instead of letting it look tested", () => {
    const copy = buildLabIsolatedCopy({
      metadata: { crmAutoMoveEnabled: true, arquivosTreinamento: ["a.pdf"], meta_provider_active: true },
      agendaAutomationEnabled: true,
    });
    expect(copy.unavailable.map(item => item.dependency).sort())
      .toEqual(["agenda_calendar", "crm", "knowledge_files", "meta_cloud"]);
    for (const item of copy.unavailable) expect(item.reason.length).toBeGreaterThan(10);
  });

  it("stays quiet about dependencies the agent does not use", () => {
    expect(buildLabIsolatedCopy({ metadata: { promptIdentidade: "x" } }).unavailable).toEqual([]);
  });

  it("marks the copy as not a system agent even if the source claimed to be one", () => {
    expect(buildLabIsolatedCopy({ metadata: { isSystemAgent: true } }).metadata.isSystemAgent).toBe(false);
  });

  it("survives absent or malformed metadata", () => {
    for (const metadata of [null, {} as Record<string, unknown>]) {
      const copy = buildLabIsolatedCopy({ metadata });
      expect(copy.withheld).toEqual([]);
      expect(copy.metadata.isSystemAgent).toBe(false);
    }
  });
});
