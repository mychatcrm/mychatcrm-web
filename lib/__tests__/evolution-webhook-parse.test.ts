import { describe, expect, it } from "vitest";
import { buildEvolutionInstanceName, buildFreshEvolutionInstanceName } from "@/lib/integrations/evolution-api";
import {
  extractInboundTextsFromEvolutionPayload,
  extractConnectionStatusReason,
  extractInstanceJid,
  extractMessageDeliveryUpdates,
  isTerminalEvolutionDisconnectReason,
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

describe("buildFreshEvolutionInstanceName", () => {
  it("extends base name with random suffix", () => {
    const base = buildEvolutionInstanceName("tenant_x", 0);
    const fresh = buildFreshEvolutionInstanceName("tenant_x", 0);
    expect(fresh.startsWith(base)).toBe(true);
    expect(fresh.length).toBe(base.length + 8);
    expect(buildFreshEvolutionInstanceName("tenant_x", 0)).not.toBe(
      buildFreshEvolutionInstanceName("tenant_x", 0),
    );
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

describe("Evolution terminal disconnect", () => {
  it("recognizes a removed/logged-out Baileys session", () => {
    const payload = { data: { state: "close", statusReason: 401 } };
    const reason = extractConnectionStatusReason(payload);
    expect(reason).toBe(401);
    expect(isTerminalEvolutionDisconnectReason(reason)).toBe(true);
  });

  it("does not treat a reconnectable restart as a terminal logout", () => {
    const payload = { data: { state: "close", statusReason: "515" } };
    const reason = extractConnectionStatusReason(payload);
    expect(reason).toBe(515);
    expect(isTerminalEvolutionDisconnectReason(reason)).toBe(false);
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

  it("preserva o instante original informado pela Evolution", () => {
    const texts = extractInboundTextsFromEvolutionPayload({
      event: "messages.upsert",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "1" },
        messageTimestamp: 1784221980,
        message: { conversation: "Amanhã às duas" },
      },
    });
    expect(texts[0]?.occurredAt).toBe("2026-07-16T17:13:00.000Z");
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

describe("extractMessageDeliveryUpdates", () => {
  it("reads classic Evolution MESSAGES_UPDATE shape", () => {
    const updates = extractMessageDeliveryUpdates({
      event: "MESSAGES_UPDATE",
      data: {
        key: { id: "MSG1", fromMe: true },
        update: { status: 3 },
      },
    });
    expect(updates).toEqual([{ messageId: "MSG1", fromMe: true, status: 3 }]);
  });

  it("reads row.status when update.status is absent", () => {
    const updates = extractMessageDeliveryUpdates({
      event: "MESSAGES_UPDATE",
      data: [{ key: { id: "MSG2", fromMe: true }, status: 2 }],
    });
    expect(updates[0]).toEqual({ messageId: "MSG2", fromMe: true, status: 2 });
  });

  it("reads nested message.key and ack fields", () => {
    const updates = extractMessageDeliveryUpdates({
      event: "messages.update",
      data: {
        message: { key: { id: "MSG3", fromMe: true } },
        ack: 3,
      },
    });
    expect(updates[0]).toEqual({ messageId: "MSG3", fromMe: true, status: 3 });
  });

  it("reads statusAck and keyId fallbacks", () => {
    const updates = extractMessageDeliveryUpdates({
      event: "MESSAGES_UPDATE",
      data: [{ keyId: "MSG4", fromMe: true, statusAck: 4 }],
    });
    expect(updates[0]).toEqual({ messageId: "MSG4", fromMe: true, status: 4 });
  });
});
