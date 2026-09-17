import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  health: vi.fn(),
  subscribe: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@/lib/integrations/whatsapp-cloud", () => ({
  checkWhatsAppCloudConnectionHealth: m.health,
}));
vi.mock("@/lib/server/whatsapp-cloud-onboarding", () => ({
  subscribeAppToWaba: m.subscribe,
  registerWhatsAppCloudNumber: m.register,
}));

import { exchangeLabMetaCode } from "@/lib/server/agent-test-lab/meta-onboarding";

describe("agent test lab Meta onboarding", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.META_APP_ID = "123456";
    process.env.META_APP_SECRET = "app-secret";
    m.health.mockResolvedValue({
      ok: true,
      displayPhoneNumber: "+55 62 99999-0000",
      verifiedName: "Laboratório",
    });
    m.subscribe.mockResolvedValue(true);
    m.register.mockResolvedValue(true);
  });

  it("uses the original Embedded Signup token when Meta does not return a second token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "embedded-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Cannot exchange this token" } }), { status: 400 }));

    const result = await exchangeLabMetaCode({
      code: "signup-code",
      wabaId: "123456789",
      phoneNumberId: "987654321",
      purpose: "sender",
    });

    expect(result.accessToken).toBe("embedded-token");
    expect(m.health).toHaveBeenCalledWith({ phoneNumberId: "987654321", accessToken: "embedded-token" });
    expect(m.subscribe).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "embedded-token" }));
    expect(m.register).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "embedded-token" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers the exchanged long-lived token when Meta returns one", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "long-token" }), { status: 200 }));

    const result = await exchangeLabMetaCode({
      code: "signup-code",
      wabaId: "123456789",
      phoneNumberId: "987654321",
      purpose: "receiver",
    });

    expect(result.accessToken).toBe("long-token");
    expect(m.health).toHaveBeenCalledWith({ phoneNumberId: "987654321", accessToken: "long-token" });
  });
});
