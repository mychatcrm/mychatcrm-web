import { describe, expect, it } from "vitest";
import { AGENT_RUNTIME_CONTRACT_VERSION } from "../version";
import { getAgentByIdForTenant, listAgentsForTenant } from "../registry";

describe("agent registry", () => {
  it("exposes a stable contract version", () => {
    expect(AGENT_RUNTIME_CONTRACT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("scopes agents by tenant on clientId", () => {
    const a = listAgentsForTenant("tenant-a");
    const b = listAgentsForTenant("tenant-b");
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((ag) => ag.clientId === "tenant-a")).toBe(true);
    expect(b.every((ag) => ag.clientId === "tenant-b")).toBe(true);
  });

  it("getAgentByIdForTenant binds result to tenant and misses unknown ids", () => {
    const id = listAgentsForTenant("tenant-x")[0]!.id;
    const hit = getAgentByIdForTenant("tenant-x", id);
    expect(hit?.id).toBe(id);
    expect(hit?.clientId).toBe("tenant-x");
    const sameTemplateIdOtherTenant = getAgentByIdForTenant("tenant-y", id);
    expect(sameTemplateIdOtherTenant?.clientId).toBe("tenant-y");
    expect(getAgentByIdForTenant("tenant-x", "id-inexistente")).toBeUndefined();
  });
});
