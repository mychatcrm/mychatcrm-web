import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMetaConnectionFailureHealth,
  persistMetaConnectionHealth,
  verifyMetaAppLeadgenWebhook,
  verifyMetaPageLeadConnection,
  verifyMetaUserAccessToken,
  type MetaAppWebhookCheck,
  type MetaUserTokenCheck,
} from "@/lib/server/meta-lead-connection-health";

const APP_ID = "1000061796297475";

function validTokenCheck(): MetaUserTokenCheck {
  return {
    ok: true,
    code: null,
    message: null,
    retryable: false,
    grantedScopes: [
      "leads_retrieval",
      "pages_manage_metadata",
      "pages_read_engagement",
      "pages_show_list",
    ],
    missingScopes: [],
    granularScopeTargets: {},
    tokenExpiresAt: null,
    dataAccessExpiresAt: null,
    tokenKind: "SYSTEM_USER",
    userId: null,
    systemUserId: "system-user-1",
  };
}

function validAppWebhook(): MetaAppWebhookCheck {
  return {
    ok: true,
    code: null,
    message: null,
    retryable: false,
    callbackUrl: "https://www.mychatcrm.com.br/api/webhooks/meta",
  };
}

describe("Meta Lead connection health", () => {
  const originalAppId = process.env.META_APP_ID;

  beforeEach(() => {
    process.env.META_APP_ID = APP_ID;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalAppId === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = originalAppId;
    vi.unstubAllGlobals();
  });

  it("validates a durable token and its mandatory scopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              app_id: APP_ID,
              is_valid: true,
              type: "SYSTEM_USER",
              system_user_id: "system-user-1",
              expires_at: 0,
              scopes: [
                "leads_retrieval",
                "pages_manage_metadata",
                "pages_read_engagement",
                "pages_show_list",
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await verifyMetaUserAccessToken({
      userAccessToken: "user-token",
      appId: APP_ID,
      appSecret: "app-secret",
      requireDurable: true,
    });

    expect(result).toMatchObject({
      ok: true,
      tokenKind: "SYSTEM_USER",
      missingScopes: [],
    });
  });

  it("rejects an app webhook pointing at another callback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                object: "page",
                active: true,
                callback_url: "https://other.example/webhook",
                fields: [{ name: "leadgen" }],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await verifyMetaAppLeadgenWebhook({
      appId: APP_ID,
      appSecret: "app-secret",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "app_webhook_callback_mismatch",
    });
  });

  it("does not declare ready when the form leads endpoint denies CRM access", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "page-1", name: "Page", tasks: ["MANAGE"] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "form-1", status: "ACTIVE" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: APP_ID,
                subscribed_fields: ["leadgen", "leadgen_update"],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "CRM has no lead access",
              type: "OAuthException",
              code: 200,
            },
          }),
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyMetaPageLeadConnection({
      pageId: "page-1",
      pageAccessToken: "page-token",
      tokenCheck: validTokenCheck(),
      appWebhook: validAppWebhook(),
    });

    const pageProbeUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(pageProbeUrl).toContain("fields=id%2Cname");
    expect(pageProbeUrl).not.toContain("tasks");

    expect(result).toMatchObject({
      status: "action_required",
      code: "lead_access_denied",
      leadAccessStatus: "action_required",
    });
  });

  it("preserves last-known-good operation on transient Meta failures", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          page_id: "page-1",
          health_status: "ready",
          lead_access_status: "verified_by_delivery",
          last_lead_access_verified_at: "2026-07-28T20:00:00.000Z",
          last_success_at: "2026-07-28T20:00:00.000Z",
          consecutive_failures: 0,
          page_access_token: "page-token",
          user_access_token: "user-token",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { page_id: "page-1" }, error: null });
    const update = vi.fn();
    const query = {
      select: vi.fn(() => query),
      update: vi.fn((value: unknown) => {
        update(value);
        return query;
      }),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      maybeSingle,
    };
    const sb = { from: vi.fn(() => query) };

    const persisted = await persistMetaConnectionHealth({
      sb: sb as never,
      tenantId: "tenant-1",
      pageId: "page-1",
      health: buildMetaConnectionFailureHealth({
        code: "graph_temporarily_unavailable",
        retryable: true,
      }),
    });

    expect(persisted).toEqual({
      status: "degraded",
      leadAccessStatus: "verified_by_delivery",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        health_status: "degraded",
        lead_access_status: "verified_by_delivery",
        consecutive_failures: 1,
      }),
    );
  });

  it("replaces historical delivery proof when Meta currently denies lead access", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          page_id: "page-1",
          health_status: "ready",
          lead_access_status: "verified_by_delivery",
          last_lead_access_verified_at: "2026-07-28T20:00:00.000Z",
          last_success_at: "2026-07-28T20:00:00.000Z",
          consecutive_failures: 0,
          page_access_token: "page-token",
          user_access_token: "user-token",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { page_id: "page-1" }, error: null });
    const update = vi.fn();
    const query = {
      select: vi.fn(() => query),
      update: vi.fn((value: unknown) => {
        update(value);
        return query;
      }),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      maybeSingle,
    };
    const sb = { from: vi.fn(() => query) };
    const health = buildMetaConnectionFailureHealth({
      code: "lead_access_denied",
    });

    const persisted = await persistMetaConnectionHealth({
      sb: sb as never,
      tenantId: "tenant-1",
      pageId: "page-1",
      health,
    });

    expect(persisted).toEqual({
      status: "action_required",
      leadAccessStatus: "action_required",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        health_status: "action_required",
        lead_access_status: "action_required",
      }),
    );
  });

  it("discards a health result produced for credentials replaced by OAuth", async () => {
    const update = vi.fn();
    const query = {
      select: vi.fn(() => query),
      update: vi.fn((value: unknown) => {
        update(value);
        return query;
      }),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          page_id: "page-1",
          health_status: "ready",
          lead_access_status: "verified_by_delivery",
          last_lead_access_verified_at: "2026-07-28T20:00:00.000Z",
          last_success_at: "2026-07-28T20:00:00.000Z",
          consecutive_failures: 0,
          credential_fingerprint: "new-fingerprint",
        },
        error: null,
      }),
    };
    const sb = { from: vi.fn(() => query) };

    const persisted = await persistMetaConnectionHealth({
      sb: sb as never,
      tenantId: "tenant-1",
      pageId: "page-1",
      expectedCredentialFingerprint: "old-fingerprint",
      health: buildMetaConnectionFailureHealth({
        code: "token_invalid",
      }),
    });

    expect(persisted).toEqual({
      status: "ready",
      leadAccessStatus: "verified_by_delivery",
      stale: true,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
