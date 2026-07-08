import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const processMetaLeadgenEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/server/meta-lead-ingest", () => ({
  processMetaLeadgenEvent,
}));

const handleWhatsAppCloudWebhookPayload = vi.hoisted(() =>
  vi.fn(async () => new Response(JSON.stringify({ ok: true, handled: "whatsapp_cloud" }), { status: 200 })),
);
vi.mock("@/lib/server/whatsapp-cloud-webhook-handler", () => ({
  handleWhatsAppCloudWebhookPayload,
}));

import { POST } from "@/app/api/webhooks/meta/route";

function postRequest(body: unknown) {
  return new Request("https://www.mychatcrm.com.br/api/webhooks/meta", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/meta — routes by payload.object", () => {
  const originalAppSecret = process.env.META_APP_SECRET;
  const originalFbSecret = process.env.FACEBOOK_APP_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    // Sem app secret configurado, a verificação de assinatura é ignorada —
    // mantém o teste focado no roteamento por object, não na verificação HMAC.
    delete process.env.META_APP_SECRET;
    delete process.env.FACEBOOK_APP_SECRET;
  });

  afterEach(() => {
    process.env.META_APP_SECRET = originalAppSecret;
    process.env.FACEBOOK_APP_SECRET = originalFbSecret;
  });

  it("delegates whatsapp_business_account payloads to the shared Cloud API handler instead of dropping them", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "waba1", changes: [{ field: "messages", value: { messages: [{ type: "text" }] } }] }],
    };

    const response = await POST(postRequest(payload) as unknown as Parameters<typeof POST>[0]);

    expect(handleWhatsAppCloudWebhookPayload).toHaveBeenCalledTimes(1);
    expect(handleWhatsAppCloudWebhookPayload).toHaveBeenCalledWith(payload);
    expect(processMetaLeadgenEvent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ handled: "whatsapp_cloud" });
  });

  it("still processes page/leadgen payloads through the existing pipeline", async () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "page1",
          changes: [{ field: "leadgen", value: { page_id: "page1", leadgen_id: "lead1" } }],
        },
      ],
    };

    const response = await POST(postRequest(payload) as unknown as Parameters<typeof POST>[0]);

    expect(processMetaLeadgenEvent).toHaveBeenCalledTimes(1);
    expect(handleWhatsAppCloudWebhookPayload).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("ignores payloads for objects it doesn't handle", async () => {
    const response = await POST(postRequest({ object: "instagram" }) as unknown as Parameters<typeof POST>[0]);

    expect(processMetaLeadgenEvent).not.toHaveBeenCalled();
    expect(handleWhatsAppCloudWebhookPayload).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
