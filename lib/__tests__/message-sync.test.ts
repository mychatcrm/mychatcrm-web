import { describe, expect, it } from "vitest";
import { shouldSendOnEnter } from "@/lib/conversas/compose-focus";
import {
  appendMessageDeduped,
  createClientTempId,
  createOptimisticOutboundMessage,
  mergePolledMessages,
  reconcileOptimisticMessage,
  shouldSkipRealtimeInsert,
} from "@/lib/conversas/message-sync";

describe("compose focus", () => {
  it("sends on Enter without Shift", () => {
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
  });

  it("does not send on Shift+Enter", () => {
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
  });
});

describe("message sync", () => {
  it("creates optimistic outbound message with temp id", () => {
    const tempId = createClientTempId();
    const message = createOptimisticOutboundMessage({ text: "Oi", clientTempId: tempId });
    expect(message.id).toBe(tempId);
    expect(message.send_status).toBe("sending");
    expect(message.delivery_status).toBe("pending");
  });

  it("reconciles optimistic message with saved row", () => {
    const tempId = createClientTempId();
    const optimistic = createOptimisticOutboundMessage({ text: "Oi", clientTempId: tempId });
    const saved = {
      ...optimistic,
      id: "db-1",
      send_status: "sent" as const,
      delivery_status: "sent",
    };
    const merged = reconcileOptimisticMessage([optimistic], tempId, saved);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("db-1");
  });

  it("skips duplicate realtime insert", () => {
    const existing = [
      createOptimisticOutboundMessage({ text: "Oi", clientTempId: "temp-1" }),
    ];
    const incoming = {
      id: "db-1",
      client_temp_id: "temp-1",
      direction: "outbound" as const,
      kind: "text",
      content: "Oi",
      created_at: new Date().toISOString(),
    };
    expect(shouldSkipRealtimeInsert(existing, incoming)).toBe(true);
    const merged = appendMessageDeduped(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("db-1");
  });

  it("mergePolledMessages keeps pending optimistic rows", () => {
    const optimistic = createOptimisticOutboundMessage({ text: "Oi", clientTempId: "temp-2" });
    const merged = mergePolledMessages([optimistic], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("temp-2");
  });
});
