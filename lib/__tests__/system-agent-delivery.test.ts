import { beforeEach, describe, expect, it, vi } from "vitest";

const selectChain = vi.hoisted(() => ({
  eq: vi.fn(),
  filter: vi.fn(),
  contains: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  lt: vi.fn(),
  in: vi.fn(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
}));

const updateMock = vi.hoisted(() => vi.fn());
const tenantAgentsMetadata = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

function resetSelectChain(final: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  selectChain.eq.mockReturnValue(selectChain);
  selectChain.filter.mockReturnValue(selectChain);
  selectChain.contains.mockReturnValue(selectChain);
  selectChain.order.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue(final);
  selectChain.lt.mockReturnValue(selectChain);
  selectChain.in.mockReturnValue(selectChain);
  selectChain.maybeSingle.mockImplementation(() =>
    Promise.resolve({ data: { metadata: tenantAgentsMetadata.value }, error: null }),
  );
  selectChain.single.mockResolvedValue({ data: null, error: null });
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      if (table === "system_notifications_log") {
        return {
          select: () => selectChain,
          update: (payload: unknown) => {
            updateMock(payload);
            return {
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
                in: () => Promise.resolve({ error: null }),
              }),
            };
          },
        };
      }
      if (table === "tenant_agents") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: selectChain.maybeSingle,
              }),
            }),
          }),
          update: (payload: { metadata?: Record<string, unknown> }) => {
            if (payload.metadata) tenantAgentsMetadata.value = payload.metadata;
            return {
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          },
        };
      }
      return { select: () => selectChain };
    },
  }),
}));

import {
  bufferOrphanDeliveryEvent,
  markSystemNotificationDelivered,
  markSystemNotificationServerAck,
  processSystemMessagesUpdate,
  reconcileOrphanDeliveryEvents,
  reconcileUndeliveredNotifications,
} from "@/lib/server/system-agent";

describe("system notification delivery helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantAgentsMetadata.value = {};
    resetSelectChain();
  });

  it("promotes pending to sent on SERVER_ACK webhook", async () => {
    selectChain.filter.mockReturnValue({
      order: () => ({
        limit: () =>
          Promise.resolve({
            data: [{ id: "row-1", status: "pending", metadata: { evolution_message_id: "ABC" } }],
            error: null,
          }),
      }),
    });

    const ok = await markSystemNotificationServerAck({ evolutionMessageId: "ABC", status: 2 });
    expect(ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        metadata: expect.objectContaining({ server_ack_status: 2 }),
      }),
    );
  });

  it("retries lookup before marking delivered (race webhook x log)", async () => {
    let calls = 0;
    selectChain.filter.mockReturnValue({
      order: () => ({
        limit: () => {
          calls += 1;
          if (calls < 3) return Promise.resolve({ data: [], error: null });
          return Promise.resolve({
            data: [{ id: "row-race", status: "pending", metadata: { evolution_message_id: "RACE1" } }],
            error: null,
          });
        },
      }),
    });

    const ok = await markSystemNotificationDelivered({ evolutionMessageId: "RACE1", status: 3 });
    expect(ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("buffers orphan delivery events when log row is missing", async () => {
    selectChain.filter.mockReturnValue({
      order: () => ({
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
    });

    const result = await processSystemMessagesUpdate({
      instanceName: "mc049357test",
      messageId: "ORPHAN1",
      status: 3,
      fromMe: true,
    });

    expect(result).toBe("buffered");
    expect(tenantAgentsMetadata.value.system_webhook_pending_delivery_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: "ORPHAN1", instanceName: "mc049357test" }),
      ]),
    );
  });

  it("reconciles orphan events after log exists", async () => {
    tenantAgentsMetadata.value = {
      system_webhook_pending_delivery_events: [
        {
          messageId: "ORPHAN2",
          status: 3,
          instanceName: "mc049357test",
          receivedAt: new Date().toISOString(),
        },
      ],
    };

    selectChain.filter.mockReturnValue({
      order: () => ({
        limit: () =>
          Promise.resolve({
            data: [{ id: "row-2", status: "sent", metadata: { evolution_message_id: "ORPHAN2" } }],
            error: null,
          }),
      }),
    });

    const result = await reconcileOrphanDeliveryEvents({ preferMessageIds: ["ORPHAN2"] });
    expect(result.applied).toBe(1);
    expect(result.remaining).toBe(0);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "delivered" }));
  });

  it("reconciles stale pending and sent notifications to delivery_failed", async () => {
    selectChain.in.mockReturnValue({
      lt: () => ({
        limit: () =>
          Promise.resolve({
            data: [
              { id: "old-pending", status: "pending", metadata: {} },
              { id: "old-sent", status: "sent", metadata: {} },
            ],
            error: null,
          }),
      }),
    });

    const count = await reconcileUndeliveredNotifications(60);
    expect(count).toBe(2);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "delivery_failed",
        error: "delivery_timeout",
      }),
    );
  });

  it("dedupes orphan buffer by message id", async () => {
    await bufferOrphanDeliveryEvent({
      messageId: "DEDUP",
      status: 2,
      instanceName: "mc049357test",
    });
    await bufferOrphanDeliveryEvent({
      messageId: "DEDUP",
      status: 3,
      instanceName: "mc049357test",
    });

    const events = tenantAgentsMetadata.value.system_webhook_pending_delivery_events as Array<{
      messageId: string;
      status: unknown;
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe(3);
  });
});
