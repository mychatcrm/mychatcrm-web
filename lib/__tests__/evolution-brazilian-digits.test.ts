import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  brazilianMobileAlternateVariant,
  buildEvolutionSendCandidates,
  ensureBrazilianMobileWhatsappDigits,
  formatEvolutionSendAddress,
  evolutionSendText,
  isEvolutionDeliveredStatus,
  isEvolutionDeliveryErrorStatus,
  isEvolutionPendingStatus,
  isEvolutionSentAckStatus,
  pickEvolutionInstanceInfo,
  type EvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import {
  extractInboundMessagesFromEvolutionPayload,
  extractMessageDeliveryUpdates,
} from "@/lib/integrations/evolution-webhook-parse";
import {
  normalizeCanonicalWhatsAppPhone,
  resolveCanonicalInboundContact,
} from "@/lib/integrations/whatsapp-contact-identity";

describe("Brazilian WhatsApp digit normalization", () => {
  it("adds the 9th digit for mobile numbers in the 12-digit format", () => {
    expect(ensureBrazilianMobileWhatsappDigits("556290000000")).toBe("5562990000000");
    expect(ensureBrazilianMobileWhatsappDigits("5562990000000")).toBe("5562990000000");
  });

  it("exposes alternate variants for Evolution number checks", () => {
    expect(brazilianMobileAlternateVariant("5562990000000")).toBe("556290000000");
    expect(brazilianMobileAlternateVariant("556290000000")).toBe("5562990000000");
  });

  it("builds send candidates with @lid JIDs only as full addresses", () => {
    const candidates = buildEvolutionSendCandidates({
      platformNumber: "5562990000000",
      jid: "5562990000000@s.whatsapp.net",
      jidAlt: "123456789@lid",
    });
    expect(candidates).not.toContain("5562990000000@s.whatsapp.net");
    expect(candidates).toContain("123456789@lid");
    expect(candidates).toContain("5562990000000");
    expect(formatEvolutionSendAddress("123456789@lid", "5562990000000")).toBe("123456789@lid");
    expect(formatEvolutionSendAddress("5562990000000", "5562990000000")).toBe("5562990000000");
    expect(formatEvolutionSendAddress("556290000000@s.whatsapp.net", "5562990000000")).toBe("5562990000000");
    expect(formatEvolutionSendAddress("556290000000", "556290000000")).toBe("5562990000000");
  });
});

describe("Evolution recipient resolution", () => {
  it("uses the validated canonical E.164 address when a successful check returns an empty envelope", async () => {
    process.env.EVOLUTION_API_BASE_URL = "https://evolution.test";
    process.env.EVOLUTION_API_KEY = "test-key";
    const sentNumbers: string[] = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("/chat/whatsappNumbers/")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes("/message/sendText/")) {
        const body = JSON.parse(String(init?.body)) as { number: string };
        sentNumbers.push(body.number);
        return new Response(JSON.stringify({
          key: { id: "message-new-contact", remoteJid: `${body.number}@s.whatsapp.net` },
          status: "SERVER_ACK",
        }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const result = await evolutionSendText({
      instanceName: "mc-test",
      number: "14155552671",
      text: "Hello",
      resolveRecipient: true,
    });

    expect(result.ok).toBe(true);
    expect(sentNumbers).toEqual(["14155552671"]);
  });
});

describe("trusted WhatsApp contact identity", () => {
  it("uses remoteJidAlt when the primary identifier is an opaque @lid", () => {
    const result = resolveCanonicalInboundContact({
      remoteJid: "123456789012345@lid",
      remoteJidAlt: "556290000000@s.whatsapp.net",
    });
    expect(result).toMatchObject({
      canonicalPhone: "5562990000000",
      canonicalRemoteJid: "5562990000000@s.whatsapp.net",
      providerRemoteJid: "123456789012345@lid",
      providerRemoteJidAlt: "556290000000@s.whatsapp.net",
      hasTrustedPhone: true,
    });
  });

  it("fails closed for a LID without a provider phone alias", () => {
    const result = resolveCanonicalInboundContact({ remoteJid: "123456789012345@lid" });
    expect(result).toMatchObject({
      canonicalPhone: null,
      canonicalRemoteJid: "123456789012345@lid",
      hasTrustedPhone: false,
    });
    expect(normalizeCanonicalWhatsAppPhone("123456789012345@lid")).toBeNull();
  });

  it("supports international provider phone JIDs without country-specific rewriting", () => {
    expect(normalizeCanonicalWhatsAppPhone("14155552671@s.whatsapp.net")).toBe("14155552671");
    expect(normalizeCanonicalWhatsAppPhone("442071838750@c.us")).toBe("442071838750");
  });

  it("publishes canonical and original identities from an Evolution payload", () => {
    const messages = extractInboundMessagesFromEvolutionPayload({
      data: {
        key: {
          id: "message-lid",
          fromMe: false,
          remoteJid: "123456789012345@lid",
          remoteJidAlt: "556290000000@s.whatsapp.net",
        },
        messageTimestamp: 1_784_250_000,
        message: { conversation: "Oi" },
      },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      remoteJid: "5562990000000@s.whatsapp.net",
      contactPhone: "5562990000000",
      providerRemoteJid: "123456789012345@lid",
      providerRemoteJidAlt: "556290000000@s.whatsapp.net",
    });
  });
});

describe("Evolution Brazilian recipient routing", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.EVOLUTION_API_BASE_URL = "https://evolution.test";
    process.env.EVOLUTION_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends with the ninth digit before trying the legacy WhatsApp alias", async () => {
    const sentNumbers: string[] = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("/chat/whatsappNumbers/")) {
        return new Response(JSON.stringify([
          {
            exists: true,
            number: "556290000000",
            jid: "556290000000@s.whatsapp.net",
          },
        ]), { status: 200 });
      }
      if (url.includes("/message/sendText/")) {
        const body = JSON.parse(String(init?.body)) as { number: string };
        sentNumbers.push(body.number);
        return new Response(JSON.stringify({
          key: { id: `message-${sentNumbers.length}`, remoteJid: `${body.number}@s.whatsapp.net` },
          status: sentNumbers.length === 1 ? "PENDING" : "SERVER_ACK",
        }), { status: 200 });
      }
      if (url.includes("/chat/findStatusMessage/")) {
        return new Response(JSON.stringify([
          {
            keyId: "message-1",
            status: "ERROR",
            remoteJid: "5562990000000@s.whatsapp.net",
            fromMe: true,
          },
        ]), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await evolutionSendText({
      instanceName: "mc-test",
      number: "5562990000000",
      text: "Teste",
      resolveRecipient: true,
    });

    expect(result.ok).toBe(true);
    expect(sentNumbers).toEqual(["5562990000000", "556290000000"]);
  });

  it("does not try another alias while delivery is still pending", async () => {
    const sentNumbers: string[] = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes("/chat/whatsappNumbers/")) {
        return new Response(JSON.stringify([
          {
            exists: true,
            number: "556290000000",
            jid: "556290000000@s.whatsapp.net",
          },
        ]), { status: 200 });
      }
      if (url.includes("/message/sendText/")) {
        const body = JSON.parse(String(init?.body)) as { number: string };
        sentNumbers.push(body.number);
        return new Response(JSON.stringify({
          key: { id: "message-pending", remoteJid: `${body.number}@s.whatsapp.net` },
          status: "PENDING",
        }), { status: 200 });
      }
      if (url.includes("/chat/findStatusMessage/")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await evolutionSendText({
      instanceName: "mc-test",
      number: "5562990000000",
      text: "Teste",
      resolveRecipient: true,
    });

    expect(result.ok).toBe(true);
    expect(sentNumbers).toEqual(["5562990000000"]);
  });
});

describe("Evolution delivery helpers", () => {
  it("treats Baileys status 0 as delivery error", () => {
    expect(isEvolutionDeliveryErrorStatus(0)).toBe(true);
    expect(isEvolutionDeliveryErrorStatus(2)).toBe(false);
    expect(isEvolutionDeliveryErrorStatus("ERROR")).toBe(true);
  });

  it("parses MESSAGES_UPDATE delivery failures", () => {
    const updates = extractMessageDeliveryUpdates({
      data: [
        {
          key: { id: "ABC123", fromMe: true, remoteJid: "5562990000000@s.whatsapp.net" },
          update: { status: 0 },
        },
      ],
    });
    expect(updates).toEqual([
      { messageId: "ABC123", fromMe: true, status: 0 },
    ]);
  });

  it("treats DELIVERY_ACK/READ/PLAYED as delivered, PENDING/SERVER_ACK as not", () => {
    expect(isEvolutionDeliveredStatus(3)).toBe(true);
    expect(isEvolutionDeliveredStatus(4)).toBe(true);
    expect(isEvolutionDeliveredStatus("DELIVERY_ACK")).toBe(true);
    expect(isEvolutionDeliveredStatus("READ")).toBe(true);
    expect(isEvolutionDeliveredStatus(2)).toBe(false);
    expect(isEvolutionDeliveredStatus("PENDING")).toBe(false);
    expect(isEvolutionDeliveredStatus("SERVER_ACK")).toBe(false);
  });

  it("recognizes PENDING as numeric 1 or string", () => {
    expect(isEvolutionPendingStatus(1)).toBe(true);
    expect(isEvolutionPendingStatus("PENDING")).toBe(true);
    expect(isEvolutionPendingStatus(2)).toBe(false);
    expect(isEvolutionSentAckStatus(2)).toBe(true);
    expect(isEvolutionSentAckStatus("SERVER_ACK")).toBe(true);
  });
});

describe("pickEvolutionInstanceInfo", () => {
  const list: EvolutionInstanceInfo[] = [
    { name: "mc-other", connectionStatus: "open", ownerJid: "5511999999999@s.whatsapp.net", profileName: "Other" },
    { name: "mc-system", connectionStatus: "open", ownerJid: "556282067910@s.whatsapp.net", profileName: "System" },
  ];

  it("selects the instance by name", () => {
    expect(pickEvolutionInstanceInfo(list, "mc-system")?.ownerJid).toBe("556282067910@s.whatsapp.net");
  });

  it("returns the only instance when there is a single one", () => {
    const single: EvolutionInstanceInfo[] = [
      { name: "weird-name", connectionStatus: "open", ownerJid: "5562000000000@s.whatsapp.net", profileName: null },
    ];
    expect(pickEvolutionInstanceInfo(single, "mc-system")?.ownerJid).toBe("5562000000000@s.whatsapp.net");
  });

  it("returns null when the named instance is missing among several", () => {
    expect(pickEvolutionInstanceInfo(list, "does-not-exist")).toBeNull();
  });
});
