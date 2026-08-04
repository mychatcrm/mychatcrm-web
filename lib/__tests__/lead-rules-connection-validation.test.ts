import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { lookupWhatsAppCloudConnectionByPhoneNumberIdMock, listWhatsAppMessageTemplatesMock } = vi.hoisted(() => ({
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock: vi.fn(),
  listWhatsAppMessageTemplatesMock: vi.fn(),
}));
const ensureTenantPageLeadgenWebhookSubscriptionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  lookupWhatsAppCloudConnectionByPhoneNumberId: lookupWhatsAppCloudConnectionByPhoneNumberIdMock,
}));
vi.mock("@/lib/integrations/whatsapp-cloud", () => ({
  listWhatsAppMessageTemplates: listWhatsAppMessageTemplatesMock,
}));
vi.mock("@/lib/server/meta-page-webhook-subscribe", () => ({
  ensureTenantPageLeadgenWebhookSubscription:
    ensureTenantPageLeadgenWebhookSubscriptionMock,
}));

import { validateMetaAutomationConnection } from "@/lib/server/lead-rules-connection-validation";

function makeSb(evoRow: { id: string } | null = { id: "evo-1" }) {
  return {
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn().mockResolvedValue({
          data:
            table === "meta_connections"
              ? {
                  health_status: "ready",
                  health_code: null,
                  health_message: null,
                  subscribed_fields: ["leadgen"],
                  last_verified_at: new Date().toISOString(),
                  page_access_token: "page-token",
                }
              : evoRow,
          error: null,
        }),
      };
      return query;
    }),
  } as never;
}

describe("validateMetaAutomationConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureTenantPageLeadgenWebhookSubscriptionMock.mockResolvedValue({
      ok: true,
      pageId: "page-1",
      pageName: "Page",
      wasSubscribed: true,
      subscribedFields: ["leadgen"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/leadgen_forms")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "form-1", status: "ACTIVE" }],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/form-1/leads")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        throw new Error(`Unexpected Meta URL: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts Evolution UUID for meta_form automation", async () => {
    const result = await validateMetaAutomationConnection(makeSb({ id: "evo-1" }), "t1", {
      source: "meta_form",
      distribution_type: "automation_agent",
      agent_ids: ["a1"],
      page_id: "page-1",
      included_form_ids: ["form-1"],
      connection_id: "evo-1",
      transport: "evolution",
    });
    expect(result).toBeNull();
  });

  it("rejects Cloud without template", async () => {
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockResolvedValue({
      tenant_id: "t1",
      active: true,
      phone_number_id: "1224395060758616",
      waba_id: "waba",
      access_token: "tok",
    });
    const result = await validateMetaAutomationConnection(makeSb(), "t1", {
      source: "meta_form",
      distribution_type: "automation_agent",
      agent_ids: ["a1"],
      page_id: "page-1",
      included_form_ids: ["form-1"],
      connection_id: "1224395060758616",
      transport: "cloud_api",
      meta_template_name: null,
    });
    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(400);
  });

  it("accepts Cloud with APPROVED template", async () => {
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockResolvedValue({
      tenant_id: "t1",
      active: true,
      phone_number_id: "1224395060758616",
      waba_id: "waba",
      access_token: "tok",
    });
    listWhatsAppMessageTemplatesMock.mockResolvedValue([
      { name: "hello_util", status: "APPROVED", language: "pt_BR" },
    ]);
    const result = await validateMetaAutomationConnection(makeSb(), "t1", {
      source: "meta_form",
      distribution_type: "automation_agent",
      agent_ids: ["a1"],
      page_id: "page-1",
      included_form_ids: ["form-1"],
      connection_id: "1224395060758616",
      transport: "cloud_api",
      meta_template_name: "hello_util",
      meta_template_lang: "pt_BR",
    });
    expect(result).toBeNull();
  });

  it("validates Meta ownership and live lead access for a CRM-only rule", async () => {
    const result = await validateMetaAutomationConnection(makeSb(), "t1", {
      source: "meta_form",
      distribution_type: "crm_only",
      agent_ids: [],
      page_id: "page-1",
      included_form_ids: ["form-1"],
    });

    expect(result).toBeNull();
  });

  it("keeps an active form and prunes archived forms from the same Page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/leadgen_forms")) {
          return new Response(
            JSON.stringify({
              data: [
                { id: "form-archived", status: "ARCHIVED" },
                { id: "form-active", status: "ACTIVE" },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/form-active/leads")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        throw new Error(`Unexpected Meta URL: ${url}`);
      }),
    );
    const payload = {
      source: "meta_form",
      distribution_type: "crm_only",
      agent_ids: [],
      page_id: "page-1",
      included_form_ids: ["form-archived", "form-active"],
    };

    const result = await validateMetaAutomationConnection(makeSb(), "t1", payload);

    expect(result).toBeNull();
    expect(payload.included_form_ids).toEqual(["form-active"]);
  });

  it("still rejects a form that does not belong to the selected Page", async () => {
    const result = await validateMetaAutomationConnection(makeSb(), "t1", {
      source: "meta_form",
      distribution_type: "crm_only",
      agent_ids: [],
      page_id: "page-1",
      included_form_ids: ["form-from-another-page"],
    });

    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(409);
    await expect(result?.json()).resolves.toMatchObject({
      code: "meta_form_not_available",
    });
  });

  it("explains when every selected form is archived", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/leadgen_forms")) {
          return new Response(
            JSON.stringify({ data: [{ id: "form-archived", status: "ARCHIVED" }] }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected Meta URL: ${url}`);
      }),
    );

    const result = await validateMetaAutomationConnection(makeSb(), "t1", {
      source: "meta_form",
      distribution_type: "crm_only",
      agent_ids: [],
      page_id: "page-1",
      included_form_ids: ["form-archived"],
    });

    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(409);
    await expect(result?.json()).resolves.toMatchObject({
      code: "meta_active_form_missing",
    });
  });

  it("rejects a rule when Meta denies live CRM lead access", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [{ id: "form-1", status: "ACTIVE" }],
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
        ),
    );

    const result = await validateMetaAutomationConnection(makeSb(), "t1", {
      source: "meta_form",
      distribution_type: "crm_only",
      agent_ids: [],
      page_id: "page-1",
      included_form_ids: ["form-1"],
    });

    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(409);
    await expect(result?.json()).resolves.toMatchObject({
      code: "lead_access_denied",
    });
  });
});
