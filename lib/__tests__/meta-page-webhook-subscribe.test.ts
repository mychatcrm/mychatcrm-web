import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureTenantPageLeadgenWebhookSubscription } from "@/lib/server/meta-page-webhook-subscribe";

function supabaseWithConnection(connection: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: connection, error: null })),
  };
  return {
    from: vi.fn(() => query),
    query,
  };
}

describe("meta page webhook subscription", () => {
  const originalMetaAppId = process.env.META_APP_ID;

  beforeEach(() => {
    process.env.META_APP_ID = "app-123";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.META_APP_ID = originalMetaAppId;
    vi.unstubAllGlobals();
  });

  it("does not resubscribe when the page already has leadgen enabled", async () => {
    const sb = supabaseWithConnection({
      page_id: "page-1",
      page_name: "Minha pagina",
      page_access_token: "token",
    });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "app-123", name: "MyChatCRM", subscribed_fields: ["leadgen"] }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureTenantPageLeadgenWebhookSubscription({
      sb: sb as unknown as Parameters<typeof ensureTenantPageLeadgenWebhookSubscription>[0]["sb"],
      tenantId: "tenant-1",
      pageId: "page-1",
    });

    expect(result.ok).toBe(true);
    expect(result.wasSubscribed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(
      false,
    );
  });

  it("subscribes the page when leadgen is missing", async () => {
    const sb = supabaseWithConnection({
      page_id: "page-1",
      page_name: "Minha pagina",
      page_access_token: "token",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "app-123", name: "MyChatCRM", subscribed_fields: ["leadgen", "leadgen_update"] }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureTenantPageLeadgenWebhookSubscription({
      sb: sb as unknown as Parameters<typeof ensureTenantPageLeadgenWebhookSubscription>[0]["sb"],
      tenantId: "tenant-1",
      pageId: "page-1",
    });

    expect(result.ok).toBe(true);
    expect(result.wasSubscribed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("fails safely when the tenant has no page token", async () => {
    const sb = supabaseWithConnection({
      page_id: "page-1",
      page_name: "Minha pagina",
      page_access_token: null,
    });

    const result = await ensureTenantPageLeadgenWebhookSubscription({
      sb: sb as unknown as Parameters<typeof ensureTenantPageLeadgenWebhookSubscription>[0]["sb"],
      tenantId: "tenant-1",
      pageId: "page-1",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_page_access_token");
  });

  it("fails closed when POST succeeds but the exact app is absent afterwards", async () => {
    const sb = supabaseWithConnection({
      page_id: "page-1",
      page_name: "Minha pagina",
      page_access_token: "token",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "different-app",
                name: "Outro CRM",
                subscribed_fields: ["leadgen"],
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureTenantPageLeadgenWebhookSubscription({
      sb: sb as unknown as Parameters<typeof ensureTenantPageLeadgenWebhookSubscription>[0]["sb"],
      tenantId: "tenant-1",
      pageId: "page-1",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("subscription_app_not_found");
  });

  it("fails closed when the exact app is present without leadgen", async () => {
    const sb = supabaseWithConnection({
      page_id: "page-1",
      page_name: "Minha pagina",
      page_access_token: "token",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "app-123",
                name: "MyChatCRM",
                subscribed_fields: ["feed"],
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureTenantPageLeadgenWebhookSubscription({
      sb: sb as unknown as Parameters<typeof ensureTenantPageLeadgenWebhookSubscription>[0]["sb"],
      tenantId: "tenant-1",
      pageId: "page-1",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("subscription_leadgen_missing");
  });
});
