import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  exchange: vi.fn(),
  connectSender: vi.fn(),
  switchSender: vi.fn(),
  connectReceiver: vi.fn(),
  switchReceiver: vi.fn(),
  calls: [] as string[],
}));

vi.mock("@/lib/server/agent-test-lab/auth", () => ({
  requireLabOwner: m.requireOwner,
  labError: (error: unknown) => Response.json({
    ok: false,
    code: error instanceof Error ? error.message : "lab_failed",
  }, { status: 400 }),
}));
vi.mock("@/lib/server/agent-test-lab/meta-onboarding", () => ({
  exchangeLabMetaCode: m.exchange,
}));
vi.mock("@/lib/server/agent-test-lab/connections", () => ({
  connectLabMetaSender: m.connectSender,
  switchLabSenderProvider: m.switchSender,
}));
vi.mock("@/lib/server/agent-test-lab/receiver", () => ({
  connectLabMetaReceiver: m.connectReceiver,
  switchLabReceiverProvider: m.switchReceiver,
}));

import { POST } from "@/app/api/admin/agent-tests/meta/exchange-code/route";

const credentials = {
  accessToken: "verified-token",
  wabaId: "waba-1",
  phoneNumberId: "phone-1",
  displayPhoneNumber: "+1 202 555 0100",
  verifiedName: "Lab",
};

function request(body: Record<string, unknown>) {
  return new Request("https://example.test/api/admin/agent-tests/meta/exchange-code", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.test" },
    body: JSON.stringify(body),
  });
}

describe("agent test lab Meta exchange route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.calls.length = 0;
    m.requireOwner.mockResolvedValue({ adminId: "owner" });
    m.exchange.mockImplementation(async () => { m.calls.push("exchange"); return credentials; });
    m.switchSender.mockImplementation(async () => { m.calls.push("switch-sender"); });
    m.connectSender.mockImplementation(async () => { m.calls.push("connect-sender"); return { provider: "meta_cloud" }; });
    m.switchReceiver.mockImplementation(async () => { m.calls.push("switch-receiver"); });
    m.connectReceiver.mockImplementation(async () => {
      m.calls.push("connect-receiver");
      return {
        connection: { provider: "meta_cloud" },
        copy: { labTenantId: "lab-t", labAgentId: "lab-a", unavailable: [] },
      };
    });
  });

  it("only replaces the tester Evolution link after Meta credentials are verified", async () => {
    const response = await POST(request({
      purpose: "sender",
      code: "code",
      waba_id: "waba-1",
      phone_number_id: "phone-1",
      replace_existing: true,
    }));

    expect(response.status).toBe(200);
    expect(m.calls).toEqual(["exchange", "switch-sender", "connect-sender"]);
    expect(m.connectSender).toHaveBeenCalledWith(credentials);
  });

  it("keeps the existing tester link when Meta verification fails", async () => {
    m.exchange.mockImplementation(async () => { m.calls.push("exchange"); throw new Error("meta_number_verification_failed"); });

    const response = await POST(request({
      purpose: "sender",
      code: "bad-code",
      waba_id: "waba-1",
      phone_number_id: "phone-1",
      replace_existing: true,
    }));

    expect(response.status).toBe(400);
    expect(m.calls).toEqual(["exchange"]);
    expect(m.switchSender).not.toHaveBeenCalled();
    expect(m.connectSender).not.toHaveBeenCalled();
  });

  it("replaces the isolated receiver only after validation and preserves its source", async () => {
    const response = await POST(request({
      purpose: "receiver",
      code: "code",
      waba_id: "waba-1",
      phone_number_id: "phone-1",
      tenantId: "tenant-source",
      agentId: "agent-source",
      replace_existing: true,
    }));

    expect(response.status).toBe(200);
    expect(m.calls).toEqual(["exchange", "switch-receiver", "connect-receiver"]);
    expect(m.switchReceiver).toHaveBeenCalledWith("meta_cloud", "tenant-source", "agent-source");
    expect(m.connectReceiver).toHaveBeenCalledWith("tenant-source", "agent-source", credentials);
  });
});
