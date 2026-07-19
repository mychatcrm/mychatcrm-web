import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveLiveEvolutionInstanceByIdForTenantMock,
  sendEvolutionTextWithConnectionRecoveryMock,
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock,
  listWhatsAppMessageTemplatesMock,
  sendWhatsAppTemplateMessageMock,
  getEvolutionInstanceByTenantSlotMock,
} = vi.hoisted(() => ({
  resolveLiveEvolutionInstanceByIdForTenantMock: vi.fn(),
  sendEvolutionTextWithConnectionRecoveryMock: vi.fn(),
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock: vi.fn(),
  listWhatsAppMessageTemplatesMock: vi.fn(),
  sendWhatsAppTemplateMessageMock: vi.fn(),
  getEvolutionInstanceByTenantSlotMock: vi.fn(),
}));

vi.mock("@/lib/server/evolution-instance-reconciliation", () => ({
  resolveLiveEvolutionInstanceByIdForTenant: resolveLiveEvolutionInstanceByIdForTenantMock,
}));
vi.mock("@/lib/server/evolution-send-recovery", () => ({
  sendEvolutionTextWithConnectionRecovery: sendEvolutionTextWithConnectionRecoveryMock,
}));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  lookupWhatsAppCloudConnectionByPhoneNumberId: lookupWhatsAppCloudConnectionByPhoneNumberIdMock,
}));
vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByTenantSlot: getEvolutionInstanceByTenantSlotMock,
}));
vi.mock("@/lib/integrations/whatsapp-cloud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/whatsapp-cloud")>(
    "@/lib/integrations/whatsapp-cloud",
  );
  return {
    ...actual,
    listWhatsAppMessageTemplates: listWhatsAppMessageTemplatesMock,
    sendWhatsAppTemplateMessage: sendWhatsAppTemplateMessageMock,
  };
});

import {
  buildMetaLeadCloudTemplateParams,
  resolveMetaLeadWhatsappConnection,
  sendMetaLeadInitialWhatsapp,
} from "@/lib/server/meta-lead-whatsapp-outreach";
import { normalizeWhatsAppCloudToWaId, sendWhatsAppTextMessage } from "@/lib/integrations/whatsapp-cloud";

describe("normalizeWhatsAppCloudToWaId", () => {
  it("strips JID suffix and non-digits", () => {
    expect(normalizeWhatsAppCloudToWaId("5511999990000@s.whatsapp.net")).toBe("5511999990000");
    expect(normalizeWhatsAppCloudToWaId("+55 11 99999-0000")).toBe("5511999990000");
  });
});

describe("sendWhatsAppTextMessage digit normalization", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { to?: string };
        expect(body.to).toBe("5511999990000");
        return new Response(JSON.stringify({ messages: [{ id: "wamid.ok" }] }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only digits even when called with a JID", async () => {
    const result = await sendWhatsAppTextMessage({
      toWaId: "5511999990000@s.whatsapp.net",
      text: "oi",
      phoneNumberId: "pn-1",
      accessToken: "token",
    });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe("wamid.ok");
  });
});

describe("buildMetaLeadCloudTemplateParams", () => {
  it("uses AI reply for single-parameter templates", () => {
    expect(
      buildMetaLeadCloudTemplateParams({
        leadName: "Ana",
        phone: "5511999",
        replyText: "Olá Ana, bem-vinda!",
        bodyParamCount: 1,
      }),
    ).toEqual(["Olá Ana, bem-vinda!"]);
  });

  it("returns empty when template has no body params", () => {
    expect(
      buildMetaLeadCloudTemplateParams({
        leadName: "Ana",
        phone: "5511999",
        replyText: "x",
        bodyParamCount: 0,
      }),
    ).toEqual([]);
  });
});

describe("resolveMetaLeadWhatsappConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves Evolution when transport is evolution", async () => {
    resolveLiveEvolutionInstanceByIdForTenantMock.mockResolvedValue({
      ok: true,
      adoptedSibling: false,
      instance: { id: "evo-1", instance_name: "mc123", connection_state: "open" },
    });
    const result = await resolveMetaLeadWhatsappConnection({
      tenantId: "t1",
      connectionId: "evo-1",
      transport: "evolution",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transport).toBe("evolution");
  });

  it("falls back to Evolution on the same slot when Cloud has no template", async () => {
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockResolvedValue({
      tenant_id: "t1",
      active: true,
      phone_number_id: "1224395060758616",
      access_token: "tok",
      waba_id: "waba",
      slot_index: 0,
    });
    getEvolutionInstanceByTenantSlotMock.mockResolvedValue({
      id: "evo-1",
      instance_name: "mc123",
      connection_state: "open",
      slot_index: 0,
    });
    resolveLiveEvolutionInstanceByIdForTenantMock.mockResolvedValue({
      ok: true,
      adoptedSibling: false,
      instance: { id: "evo-1", instance_name: "mc123", connection_state: "open" },
    });
    const result = await resolveMetaLeadWhatsappConnection({
      tenantId: "t1",
      connectionId: "1224395060758616",
      transport: "cloud_api",
      metaTemplateName: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.transport === "evolution") {
      expect(result.fallbackFromCloud?.reason).toBe("meta_template_missing");
      expect(result.instance.id).toBe("evo-1");
    }
  });

  it("fails when Cloud has no template and Evolution slot is unavailable", async () => {
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockResolvedValue({
      tenant_id: "t1",
      active: true,
      phone_number_id: "1224395060758616",
      access_token: "tok",
      waba_id: "waba",
      slot_index: 0,
    });
    getEvolutionInstanceByTenantSlotMock.mockResolvedValue(null);
    const result = await resolveMetaLeadWhatsappConnection({
      tenantId: "t1",
      connectionId: "1224395060758616",
      transport: "cloud_api",
      metaTemplateName: null,
    });
    expect(result).toEqual({ ok: false, reason: "meta_template_missing" });
  });

  it("resolves Cloud when template is APPROVED", async () => {
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockResolvedValue({
      tenant_id: "t1",
      active: true,
      phone_number_id: "1224395060758616",
      access_token: "tok",
      waba_id: "waba",
    });
    listWhatsAppMessageTemplatesMock.mockResolvedValue([
      { name: "hello_util", status: "APPROVED", language: "pt_BR", bodyParamCount: 1, category: "UTILITY", bodyText: "Olá {{1}}" },
    ]);
    const result = await resolveMetaLeadWhatsappConnection({
      tenantId: "t1",
      connectionId: "1224395060758616",
      transport: "cloud_api",
      metaTemplateName: "hello_util",
      metaTemplateLang: "pt_BR",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.transport === "cloud_api") {
      expect(result.templateName).toBe("hello_util");
      expect(result.bodyParamCount).toBe(1);
    }
  });
});

describe("sendMetaLeadInitialWhatsapp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends Evolution free text", async () => {
    sendEvolutionTextWithConnectionRecoveryMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { key: { id: "evo.1" } },
      restarted: false,
      attempts: 1,
    });
    const result = await sendMetaLeadInitialWhatsapp({
      connection: {
        ok: true,
        transport: "evolution",
        connectionId: "evo-1",
        adoptedSibling: false,
        instance: { id: "evo-1", instance_name: "mc123", connection_state: "open" },
      },
      evoNumber: "5511999990000",
      phone: "5511999990000",
      leadName: "Ana",
      replyText: "Olá!",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channel).toBe("evolution");
    expect(sendEvolutionTextWithConnectionRecoveryMock).toHaveBeenCalledTimes(1);
  });

  it("sends Meta Cloud template", async () => {
    sendWhatsAppTemplateMessageMock.mockResolvedValue({ ok: true, status: 200, messageId: "wamid.tpl" });
    const result = await sendMetaLeadInitialWhatsapp({
      connection: {
        ok: true,
        transport: "cloud_api",
        connectionId: "1224395060758616",
        phoneNumberId: "1224395060758616",
        accessToken: "tok",
        wabaId: "waba",
        templateName: "hello_util",
        templateLang: "pt_BR",
        bodyParamCount: 1,
      },
      evoNumber: "5511999990000",
      phone: "5511999990000",
      leadName: "Ana",
      replyText: "Olá Ana!",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.channel).toBe("meta_cloud");
      expect(result.providerMessageId).toBe("wamid.tpl");
    }
    expect(sendWhatsAppTemplateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: "hello_util",
        toWaId: "5511999990000",
        bodyParams: ["Olá Ana!"],
      }),
    );
  });
});
