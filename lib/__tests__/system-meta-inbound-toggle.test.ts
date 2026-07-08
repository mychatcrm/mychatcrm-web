import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppInboundMessage } from "@/lib/integrations/whatsapp-cloud";

const { getSystemAgentMetaConfigMock, insertMock, sendWhatsAppTextMessageMock, upsertLeadMock, generateAgentResponseMock } =
  vi.hoisted(() => ({
    getSystemAgentMetaConfigMock: vi.fn(),
    insertMock: vi.fn(),
    sendWhatsAppTextMessageMock: vi.fn(),
    upsertLeadMock: vi.fn(),
    generateAgentResponseMock: vi.fn(),
  }));

vi.mock("@/lib/server/system-agent", () => ({
  getSystemAgentMetaConfig: getSystemAgentMetaConfigMock,
  SYSTEM_AGENT_ID: "system-agent-internal",
  SYSTEM_TENANT_ID: "tenant-system-internal",
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}));

vi.mock("@/lib/server/auto-lead-upsert", () => ({
  upsertLeadFromWhatsAppContact: upsertLeadMock,
}));

vi.mock("@/lib/ai/generate-agent-response", () => ({
  generateAgentResponse: generateAgentResponseMock,
}));

vi.mock("@/lib/integrations/whatsapp-cloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/whatsapp-cloud")>();
  return {
    ...actual,
    sendWhatsAppTextMessage: sendWhatsAppTextMessageMock,
    fetchWhatsAppCloudMedia: vi.fn(async () => null),
  };
});

vi.mock("@/lib/ai/media-processor", () => ({
  transcribeAudioFromBuffer: vi.fn(async () => null),
  describeImageFromBuffer: vi.fn(async () => null),
}));

vi.mock("@/lib/integrations/r2-storage", () => ({
  uploadMediaToR2: vi.fn(async () => null),
}));

import { handleSystemMetaInbound } from "@/lib/server/system-meta-inbound";

function inboundFixture(overrides: Partial<WhatsAppInboundMessage> = {}): WhatsAppInboundMessage {
  return {
    fromWaId: "5562999990000",
    phoneNumberId: "123456789012345",
    displayPhoneNumber: "+55 62 99999-0000",
    messageId: "wamid.TEST",
    contactName: "Cliente Teste",
    kind: "text",
    text: "Olá",
    mediaId: null,
    mimeType: null,
    caption: null,
    ...overrides,
  };
}

describe("handleSystemMetaInbound — respects the QR/Meta toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "msg-1" }, error: null }) }),
    });
    upsertLeadMock.mockResolvedValue({ lead: { id: "lead-1" } });
    generateAgentResponseMock.mockResolvedValue({ ok: true, text: "Resposta automática" });
    sendWhatsAppTextMessageMock.mockResolvedValue({ ok: true, messageId: "wamid.OUT" });
  });

  it("does nothing when no Meta config is saved at all", async () => {
    getSystemAgentMetaConfigMock.mockResolvedValueOnce(null);

    const handled = await handleSystemMetaInbound(inboundFixture());

    expect(handled).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
  });

  it("stays silent when Meta credentials are saved but the toggle points to QR Code (active: false)", async () => {
    getSystemAgentMetaConfigMock.mockResolvedValueOnce({
      phoneNumberId: "123456789012345",
      accessToken: "token-abc",
      displayPhone: "+55 62 99999-0000",
      verifiedName: "MyChatCRM",
      active: false,
    });

    const handled = await handleSystemMetaInbound(inboundFixture());

    expect(handled).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertLeadMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
  });

  it("ignores inbound for a different phone_number_id even when the toggle is on Meta", async () => {
    getSystemAgentMetaConfigMock.mockResolvedValueOnce({
      phoneNumberId: "999999999999999",
      accessToken: "token-abc",
      displayPhone: null,
      verifiedName: null,
      active: true,
    });

    const handled = await handleSystemMetaInbound(inboundFixture({ phoneNumberId: "123456789012345" }));

    expect(handled).toBe(false);
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
  });

  it("processes and replies when the toggle is on Meta and the phone number matches", async () => {
    getSystemAgentMetaConfigMock.mockResolvedValueOnce({
      phoneNumberId: "123456789012345",
      accessToken: "token-abc",
      displayPhone: "+55 62 99999-0000",
      verifiedName: "MyChatCRM",
      active: true,
    });

    const handled = await handleSystemMetaInbound(inboundFixture());

    expect(handled).toBe(true);
    expect(upsertLeadMock).toHaveBeenCalledTimes(1);
    expect(generateAgentResponseMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: "123456789012345", toWaId: "5562999990000" }),
    );
  });

  it("tags every saved message with channel: meta_cloud, for the live-conversations channel filter", async () => {
    getSystemAgentMetaConfigMock.mockResolvedValueOnce({
      phoneNumberId: "123456789012345",
      accessToken: "token-abc",
      displayPhone: "+55 62 99999-0000",
      verifiedName: "MyChatCRM",
      active: true,
    });

    await handleSystemMetaInbound(inboundFixture());

    expect(insertMock).toHaveBeenCalledTimes(2);
    for (const call of insertMock.mock.calls) {
      expect(call[0]).toMatchObject({ channel: "meta_cloud" });
    }
  });
});
