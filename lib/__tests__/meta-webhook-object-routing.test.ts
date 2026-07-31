import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const waitUntil = vi.hoisted(() => vi.fn((promise: Promise<unknown>) => promise));
vi.mock("@vercel/functions", () => ({
  waitUntil,
}));

const enqueueMetaLeadgenEvents = vi.hoisted(() =>
  vi.fn(async () => ({ jobIds: ["job-1"] })),
);
const processMetaLeadgenInbox = vi.hoisted(() =>
  vi.fn(async () => ({
    claimed: 1,
    completed: 1,
    retrying: 0,
    deadLetter: 0,
    claimLost: 0,
    errors: 0,
  })),
);
vi.mock("@/lib/server/meta-leadgen-inbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/meta-leadgen-inbox")>()),
  enqueueMetaLeadgenEvents,
  processMetaLeadgenInbox,
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
  const originalSignatureBypass = process.env.WEBHOOK_SIGNATURE_BYPASS;

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicit test-only bypass keeps these cases focused on object routing.
    delete process.env.META_APP_SECRET;
    delete process.env.FACEBOOK_APP_SECRET;
    process.env.WEBHOOK_SIGNATURE_BYPASS = "true";
  });

  afterEach(() => {
    process.env.META_APP_SECRET = originalAppSecret;
    process.env.FACEBOOK_APP_SECRET = originalFbSecret;
    process.env.WEBHOOK_SIGNATURE_BYPASS = originalSignatureBypass;
  });

  it("delegates whatsapp_business_account payloads to the shared Cloud API handler instead of dropping them", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "waba1", changes: [{ field: "messages", value: { messages: [{ type: "text" }] } }] }],
    };

    const response = await POST(postRequest(payload) as unknown as Parameters<typeof POST>[0]);

    expect(handleWhatsAppCloudWebhookPayload).toHaveBeenCalledTimes(1);
    expect(handleWhatsAppCloudWebhookPayload).toHaveBeenCalledWith(payload);
    expect(enqueueMetaLeadgenEvents).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ handled: "whatsapp_cloud" });
  });

  it("persists page/leadgen payloads before acknowledging and dispatches the durable worker", async () => {
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

    expect(enqueueMetaLeadgenEvents).toHaveBeenCalledWith({
      events: [
        expect.objectContaining({
          event_field: "leadgen",
          page_id: "page1",
          leadgen_id: "lead1",
        }),
      ],
    });
    expect(processMetaLeadgenInbox).toHaveBeenCalledWith({
      jobIds: ["job-1"],
      limit: 1,
    });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(handleWhatsAppCloudWebhookPayload).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ ok: true, queued: 1 });
  });

  it("returns 503 so Meta retries when durable persistence fails", async () => {
    enqueueMetaLeadgenEvents.mockRejectedValueOnce(new Error("database unavailable"));
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

    expect(response.status).toBe(503);
    expect(processMetaLeadgenInbox).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "leadgen_persist_failed",
    });
  });

  it("ignores payloads for objects it doesn't handle", async () => {
    const response = await POST(postRequest({ object: "instagram" }) as unknown as Parameters<typeof POST>[0]);

    expect(enqueueMetaLeadgenEvents).not.toHaveBeenCalled();
    expect(handleWhatsAppCloudWebhookPayload).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
