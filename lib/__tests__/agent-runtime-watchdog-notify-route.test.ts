import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminSessionByIdFromDb, sendTransactionalEmail } = vi.hoisted(() => ({
  getAdminSessionByIdFromDb: vi.fn(),
  sendTransactionalEmail: vi.fn(),
}));

vi.mock("@/lib/server/admin-auth-db", () => ({ getAdminSessionByIdFromDb }));
vi.mock("@/lib/server/resend-mail", () => ({ sendTransactionalEmail }));

import { POST } from "@/app/api/internal/agent-runtime-watchdog/notify/route";

function request(body: Record<string, unknown>, secret = "watchdog-secret-with-at-least-24-characters") {
  return new Request("https://www.mychatcrm.com.br/api/internal/agent-runtime-watchdog/notify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("agent runtime watchdog email relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_RUNTIME_WATCHDOG_SECRET", "watchdog-secret-with-at-least-24-characters");
    getAdminSessionByIdFromDb.mockResolvedValue({ email: "owner@example.com" });
    sendTransactionalEmail.mockResolvedValue({ ok: true });
  });

  it("rejects an invalid bearer token", async () => {
    const response = await POST(request({ kind: "failure" }, "invalid-secret"));
    expect(response.status).toBe(401);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("rejects unknown notification kinds", async () => {
    const response = await POST(request({ kind: "custom" }));
    expect(response.status).toBe(400);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("sends safe test notifications only to the operational audit owner", async () => {
    const response = await POST(request({
      kind: "failure",
      mode: "test_failure",
      reasons: ["runtime_unhealthy", "invalid reason is dropped"],
    }));

    expect(response.status).toBe(200);
    expect(getAdminSessionByIdFromDb).toHaveBeenCalledWith("admin-renato-lagares");
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
      subject: expect.stringContaining("TESTE SEGURO"),
      text: expect.stringContaining("runtime_unhealthy"),
    }));
  });

  it("fails closed when the owner email is unavailable", async () => {
    getAdminSessionByIdFromDb.mockResolvedValue(null);
    const response = await POST(request({ kind: "recovery", mode: "live" }));
    expect(response.status).toBe(503);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("propagates a provider failure without leaking payloads", async () => {
    sendTransactionalEmail.mockResolvedValue({ ok: false, code: "http_error", detail: "403" });
    const response = await POST(request({ kind: "repeat", mode: "test_repeat" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, code: "http_error", detail: "403" });
  });
});
