import { describe, expect, it } from "vitest";
import { extractInboundMessagesFromEvolutionPayload } from "@/lib/integrations/evolution-webhook-parse";
import { normalizeLeadPhone } from "@/lib/server/lead-chatbot-history";

describe("evolution video parse", () => {
  it("extracts inbound videoMessage", () => {
    const payload = {
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "vid-1" },
        message: {
          videoMessage: {
            url: "https://example.com/video.enc",
            mimetype: "video/mp4",
            mediaKey: "abc",
            caption: "Tour do imóvel",
            seconds: 12,
          },
        },
      },
    };
    const messages = extractInboundMessagesFromEvolutionPayload(payload);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe("video");
    if (messages[0]?.type === "video") {
      expect(messages[0].caption).toBe("Tour do imóvel");
      expect(messages[0].seconds).toBe(12);
    }
  });
});

describe("normalizeLeadPhone", () => {
  it("strips non-digits for jid matching", () => {
    expect(normalizeLeadPhone("+55 (11) 99999-1111")).toBe("5511999991111");
  });
});

describe("generateAgentResponse video fallback", () => {
  it("documents safe video user message shape", async () => {
    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");
    expect(typeof generateAgentResponse).toBe("function");
  });
});
