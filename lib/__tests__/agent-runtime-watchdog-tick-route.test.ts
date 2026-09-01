import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendOperationalAuditEvent, rpc, sendWatchdogEmailNotification } = vi.hoisted(() => ({
  appendOperationalAuditEvent: vi.fn(),
  rpc: vi.fn(),
  sendWatchdogEmailNotification: vi.fn(),
}));

vi.mock("@/lib/server/operational-audit", () => ({ appendOperationalAuditEvent }));
vi.mock("@/lib/server/agent-runtime-watchdog-notifications", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server/agent-runtime-watchdog-notifications")>(),
  sendWatchdogEmailNotification,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({ rpc }),
}));

import { POST } from "@/app/api/internal/agent-runtime-watchdog/tick/route";
import { AGENT_RUNTIME_WATCHDOG_TICK_PATH } from "@/lib/server/meta-scheduler-auth";

const SECRET = "watchdog-fallback-scheduler-secret-32-bytes";
const NONCE = "2f6f266c-65e0-4da9-871d-123456789abc";

function request(valid = true): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", valid ? SECRET : "wrong-secret-with-at-least-32-bytes")
    .update(["POST", AGENT_RUNTIME_WATCHDOG_TICK_PATH, timestamp, NONCE].join("\n"), "utf8")
    .digest("hex");
  return new Request(`https://www.mychatcrm.com.br${AGENT_RUNTIME_WATCHDOG_TICK_PATH}`, {
    method: "POST",
    headers: {
      "x-mychatcrm-timestamp": timestamp,
      "x-mychatcrm-nonce": NONCE,
      "x-mychatcrm-signature": `sha256=${signature}`,
    },
  });
}

describe("durable agent runtime watchdog tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("META_LEADGEN_SCHEDULER_SECRET", SECRET);
    appendOperationalAuditEvent.mockResolvedValue({ eventId: "event-1" });
    sendWatchdogEmailNotification.mockResolvedValue({ ok: true, code: "email_sent" });
  });

  it("rejects an invalid scheduler signature", async () => {
    const response = await POST(request(false));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records one healthy operation without sending an alert", async () => {
    rpc
      .mockResolvedValueOnce({ data: { status: "healthy", reasons: [] }, error: null })
      .mockResolvedValueOnce({ data: { status: "healthy", notification: null }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(sendWatchdogEmailNotification).not.toHaveBeenCalled();
    expect(appendOperationalAuditEvent).toHaveBeenCalledTimes(2);
    expect(appendOperationalAuditEvent.mock.calls[0][0].operationId).toBe(NONCE);
    expect(appendOperationalAuditEvent.mock.calls[1][0]).toMatchObject({
      operationId: NONCE,
      action: "check.completed",
      status: "completed",
      resultCode: "runtime_healthy",
    });
  });

  it("sends one transition alert and fails closed for an unhealthy runtime", async () => {
    rpc
      .mockResolvedValueOnce({ data: { status: "unhealthy", reasons: ["queue_overdue"] }, error: null })
      .mockResolvedValueOnce({ data: { status: "unhealthy", notification: "failure" }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(sendWatchdogEmailNotification).toHaveBeenCalledWith({
      kind: "failure",
      mode: "live",
      reasons: ["queue_overdue"],
    });
    expect(appendOperationalAuditEvent.mock.calls[1][0]).toMatchObject({
      status: "error",
      critical: true,
      resultCode: "queue_overdue",
    });
  });
});

