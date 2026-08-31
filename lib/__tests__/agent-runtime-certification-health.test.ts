import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isAuthorizedAgentRuntimeHealthRequest,
  sanitizeAgentRuntimeHealth,
} from "@/lib/server/agent-runtime-health";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260830172333_agent_runtime_certification_health_v1.sql"),
  "utf8",
);

describe("agent runtime certification health", () => {
  const originalWatchdogSecret = process.env.AGENT_RUNTIME_WATCHDOG_SECRET;
  const originalInternalToken = process.env.INTERNAL_API_TOKEN;

  afterEach(() => {
    if (originalWatchdogSecret === undefined) delete process.env.AGENT_RUNTIME_WATCHDOG_SECRET;
    else process.env.AGENT_RUNTIME_WATCHDOG_SECRET = originalWatchdogSecret;
    if (originalInternalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalInternalToken;
  });

  it("exports only aggregate, content-free health data", () => {
    const health = sanitizeAgentRuntimeHealth({
      version: 1,
      generatedAt: "2026-08-30T10:00:00.000Z",
      status: "healthy",
      reasons: [],
      heartbeat: { monitorObservedAt: "2026-08-30T10:00:00.000Z", monitorAgeSeconds: 2, monitorStatus: "ok" },
      schedulers: { staleCount: 0, failuresLast5Minutes: 0 },
      queues: {
        agentResponse: { overdue: 0, expiredClaims: 0, prompt: "must-not-leak" },
        evolutionInbox: {}, followUp: {}, agendaReminder: {}, outbox: {},
        terminalFailuresSinceActivation: 0,
      },
      alerts: { criticalOpen: 0, warningOpen: 0 },
      phone: "+5511999999999",
      token: "secret",
    });
    expect(health.status).toBe("healthy");
    expect(JSON.stringify(health)).not.toMatch(/must-not-leak|5511999999999|secret/);
  });

  it("fails closed on an invalid contract", () => {
    const health = sanitizeAgentRuntimeHealth({ status: "healthy" });
    expect(health.status).toBe("unhealthy");
    expect(health.reasons).toContain("health_contract_invalid");
  });

  it("requires a timing-safe backend secret", () => {
    process.env.AGENT_RUNTIME_WATCHDOG_SECRET = "watchdog-secret-123";
    delete process.env.INTERNAL_API_TOKEN;
    expect(isAuthorizedAgentRuntimeHealthRequest(new Request("https://example.test", {
      headers: { Authorization: "Bearer watchdog-secret-123" },
    }))).toBe(true);
    expect(isAuthorizedAgentRuntimeHealthRequest(new Request("https://example.test", {
      headers: { Authorization: "Bearer wrong" },
    }))).toBe(false);
  });

  it("keeps health and kill-switch RPCs service-role only", () => {
    expect(MIGRATION).toContain("get_agent_runtime_health_v1");
    expect(MIGRATION).toContain("get_agent_runtime_subsystem_control_v1");
    expect(MIGRATION).toContain("set_agent_runtime_subsystem_control_v1");
    expect(MIGRATION).toMatch(/revoke all on function public\.get_agent_runtime_health_v1\(\)[\s\S]*?from public, anon, authenticated/i);
    expect(MIGRATION).toMatch(/grant execute on function public\.get_agent_runtime_health_v1\(\) to service_role/i);
  });

  it("hardens pg_net in place and never moves or deletes the extension", () => {
    expect(MIGRATION).toContain("revoke all on schema net from public, anon, authenticated");
    expect(MIGRATION).not.toMatch(/alter\s+extension\s+pg_net\s+set\s+schema/i);
    expect(MIGRATION).not.toMatch(/drop\s+extension\s+(?:if\s+exists\s+)?pg_net/i);
  });
});
