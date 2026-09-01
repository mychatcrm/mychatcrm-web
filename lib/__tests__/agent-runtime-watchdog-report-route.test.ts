import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendOperationalAuditEvent } = vi.hoisted(() => ({
  appendOperationalAuditEvent: vi.fn(),
}));

vi.mock("@/lib/server/operational-audit", () => ({ appendOperationalAuditEvent }));

import { POST } from "@/app/api/internal/agent-runtime-watchdog/report/route";

function request(body: Record<string, unknown>, secret = "watchdog-secret-with-at-least-24-characters") {
  return new Request("https://www.mychatcrm.com.br/api/internal/agent-runtime-watchdog/report", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent runtime watchdog audit report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_RUNTIME_WATCHDOG_SECRET", "watchdog-secret-with-at-least-24-characters");
    appendOperationalAuditEvent.mockResolvedValue({ eventId: "event-1" });
  });

  it("rejects an invalid bearer token", async () => {
    const response = await POST(request({}, "invalid-secret"));
    expect(response.status).toBe(401);
    expect(appendOperationalAuditEvent).not.toHaveBeenCalled();
  });

  it("uses one stable operation for the started and completed phases of a run", async () => {
    await POST(request({ mode: "live", phase: "started", healthy: true, runId: "33455973826" }));
    await POST(request({ mode: "live", phase: "completed", healthy: true, runId: "33455973826" }));

    const first = appendOperationalAuditEvent.mock.calls[0]?.[0];
    const second = appendOperationalAuditEvent.mock.calls[1]?.[0];
    expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.operationId).toBe(first.operationId);
    expect(first.status).toBe("running");
    expect(second.status).toBe("completed");
  });

  it("does not trust malformed external run identifiers", async () => {
    await POST(request({ mode: "live", phase: "completed", healthy: true, runId: "../../secret" }));
    expect(appendOperationalAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: undefined, relatedIds: {} }),
      { strict: true },
    );
  });
});
