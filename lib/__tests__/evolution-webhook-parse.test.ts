import { describe, expect, it } from "vitest";
import { buildEvolutionInstanceName } from "@/lib/integrations/evolution-api";
import {
  extractInboundTextsFromEvolutionPayload,
  extractInstanceJid,
} from "@/lib/integrations/evolution-webhook-parse";

describe("buildEvolutionInstanceName", () => {
  it("is deterministic per tenant and slot", () => {
    expect(buildEvolutionInstanceName("acme", 0)).toBe(buildEvolutionInstanceName("acme", 0));
    expect(buildEvolutionInstanceName("acme", 0)).not.toBe(buildEvolutionInstanceName("acme", 1));
    expect(buildEvolutionInstanceName("acme", 0)).not.toBe(buildEvolutionInstanceName("other", 0));
  });

  it("matches expected length prefix", () => {
    const n = buildEvolutionInstanceName("tenant_x", 2);
    expect(n.startsWith("mc")).toBe(true);
    expect(n.length).toBeLessThanOrEqual(32);
  });
});

describe("extractInstanceJid", () => {
  it("reads the connected instance jid from connection payloads", () => {
    expect(extractInstanceJid({
      event: "connection.update",
      data: { state: "open", wuid: "551133334444@s.whatsapp.net" },
    })).toBe("551133334444@s.whatsapp.net");
  });

  it("does not confuse customer remoteJid with the connected instance jid", () => {
    expect(extractInstanceJid({
      event: "messages.upsert",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "1" },
        message: { conversation: "Olá" },
      },
    })).toBeNull();
  });
});

describe("extractInboundTextsFromEvolutionPayload", () => {
  it("reads single message node", () => {
    const texts = extractInboundTextsFromEvolutionPayload({
      event: "messages.upsert",
      instance: "mcabc",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "1" },
        message: { conversation: "Olá" },
      },
    });
    expect(texts).toHaveLength(1);
    expect(texts[0]?.text).toBe("Olá");
  });

  it("ignores fromMe and groups", () => {
    const texts = extractInboundTextsFromEvolutionPayload({
      event: "MESSAGES_UPSERT",
      data: {
        messages: [
          {
            key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true, id: "a" },
            message: { conversation: "self" },
          },
          {
            key: { remoteJid: "120363@g.us", fromMe: false, id: "b" },
            message: { conversation: "group" },
          },
        ],
      },
    });
    expect(texts).toHaveLength(0);
  });
});
