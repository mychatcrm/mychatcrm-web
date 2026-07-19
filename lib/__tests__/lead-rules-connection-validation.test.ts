import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { lookupWhatsAppCloudConnectionByPhoneNumberIdMock, listWhatsAppMessageTemplatesMock } = vi.hoisted(() => ({
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock: vi.fn(),
  listWhatsAppMessageTemplatesMock: vi.fn(),
}));

vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  lookupWhatsAppCloudConnectionByPhoneNumberId: lookupWhatsAppCloudConnectionByPhoneNumberIdMock,
}));
vi.mock("@/lib/integrations/whatsapp-cloud", () => ({
  listWhatsAppMessageTemplates: listWhatsAppMessageTemplatesMock,
}));

import { validateMetaAutomationConnection } from "@/lib/server/lead-rules-connection-validation";

function makeSb(evoRow: { id: string } | null = { id: "evo-1" }) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: evoRow, error: null });
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle,
          })),
        })),
      })),
    })),
  } as never;
}

describe("validateMetaAutomationConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts Evolution UUID for meta_form automation", async () => {
    const result = await validateMetaAutomationConnection(makeSb({ id: "evo-1" }), "t1", {
      source: "meta_form",
      distribution_type: "automation_agent",
      agent_ids: ["a1"],
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
      connection_id: "1224395060758616",
      transport: "cloud_api",
      meta_template_name: "hello_util",
      meta_template_lang: "pt_BR",
    });
    expect(result).toBeNull();
  });
});
