import { afterEach, describe, expect, it, vi } from "vitest";
import { isChatWidgetTenantAgentAllowed } from "@/lib/ai/chat-widget-allowlist";

describe("isChatWidgetTenantAgentAllowed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows default public marketing pair", () => {
    vi.stubEnv("CHAT_WIDGET_TENANT_AGENT_ALLOWLIST", "");
    expect(isChatWidgetTenantAgentAllowed("public", "marketing_site_assistant")).toBe(true);
  });

  it("rejects unknown pair when allowlist is default", () => {
    vi.stubEnv("CHAT_WIDGET_TENANT_AGENT_ALLOWLIST", "");
    expect(isChatWidgetTenantAgentAllowed("other", "x")).toBe(false);
  });

  it("respects custom allowlist", () => {
    vi.stubEnv("CHAT_WIDGET_TENANT_AGENT_ALLOWLIST", "acme:agent-1,acme:agent-2");
    expect(isChatWidgetTenantAgentAllowed("acme", "agent-1")).toBe(true);
    expect(isChatWidgetTenantAgentAllowed("acme", "agent-2")).toBe(true);
    expect(isChatWidgetTenantAgentAllowed("acme", "agent-3")).toBe(false);
  });
});
