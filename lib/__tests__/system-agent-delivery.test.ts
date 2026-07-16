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
  applyMetaSystemNotificationStatus,
  bufferOrphanDeliveryEvent,
  clearSystemAgentWebhookMetadata,
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

  it("promotes accepted pending to sent and only fails sends Evolution never accepted", async () => {
    selectChain.limit.mockResolvedValue({
      data: [
        { id: "accepted", status: "pending", metadata: { evolution_message_id: "MID1" } },
        { id: "never-accepted", status: "pending", metadata: {} },
      ],
      error: null,
    });

    const count = await reconcileUndeliveredNotifications(60);
    expect(count).toBe(2);
    // Envio aceito pela Evolution → promovido a "sent" (nunca "delivery_failed").
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
    // Envio que a Evolution nunca aceitou → falha real.
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "evolution_not_accepted" }),
    );
    // Garante que NUNCA marcamos como "delivery_failed" por timeout de webhook.
    expect(updateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: "delivery_timeout" }),
    );
  });

  it("recognizes Meta Cloud API acceptance via meta_message_id (regression: used to be mislabeled evolution_not_accepted)", async () => {
    selectChain.limit.mockResolvedValue({
      data: [
        {
          id: "meta-accepted",
          status: "pending",
          metadata: { provider: "meta_cloud", meta_message_id: "wamid.ABC123" },
        },
        {
          id: "meta-never-accepted",
          status: "pending",
          metadata: { provider: "meta_cloud" },
        },
      ],
      error: null,
    });

    const count = await reconcileUndeliveredNotifications(60);
    expect(count).toBe(2);
    // A Meta aceitou (meta_message_id existe) → promovido a "sent", NUNCA "evolution_not_accepted".
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
    expect(updateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: "evolution_not_accepted" }),
    );
    // A Meta nunca aceitou (sem meta_message_id) → falha real com rótulo correto do provedor.
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "meta_not_accepted" }),
    );
  });

  it("promotes delivery_failed to delivered when webhook confirms delivery", async () => {
    selectChain.filter.mockReturnValue({
      order: () => ({
        limit: () =>
          Promise.resolve({
            data: [{ id: "row-fix", status: "delivery_failed", metadata: { evolution_message_id: "FIX1" } }],
            error: null,
          }),
      }),
    });

    const ok = await markSystemNotificationDelivered({ evolutionMessageId: "FIX1", status: 3 });
    expect(ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "delivered",
        error: null,
        metadata: expect.objectContaining({ delivery_corrected_from: "delivery_failed" }),
      }),
    );
  });

  it("ignores SERVER_ACK after delivered (monotonic)", async () => {
    selectChain.filter.mockReturnValue({
      order: () => ({
        limit: () =>
          Promise.resolve({
            data: [{ id: "row-d", status: "delivered", metadata: { evolution_message_id: "D1" } }],
            error: null,
          }),
      }),
    });

    const ok = await markSystemNotificationServerAck({ evolutionMessageId: "D1", status: 2 });
    expect(ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("ignores Meta failed after delivered (monotonic)", async () => {
    selectChain.filter.mockReturnValue({
      order: () => ({
        limit: () =>
          Promise.resolve({
            data: [{ id: "meta-d", status: "delivered", metadata: { provider: "meta_cloud", meta_message_id: "wamid.D" } }],
            error: null,
          }),
      }),
    });

    const result = await applyMetaSystemNotificationStatus({
      wamid: "wamid.D",
      status: "failed",
      errorCode: 131047,
      errorTitle: "Re-engagement message",
    });

    expect(result).toBe("skipped");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("records the real Meta error code when a status webhook reports failed", async () => {
    selectChain.filter.mockReturnValue({
      order: () => ({
        limit: () =>
          Promise.resolve({
            data: [{ id: "meta-fail", status: "sent", metadata: { provider: "meta_cloud", meta_message_id: "wamid.X" } }],
            error: null,
          }),
      }),
    });

    const result = await applyMetaSystemNotificationStatus({
      wamid: "wamid.X",
      status: "failed",
      errorCode: 131047,
      errorTitle: "Re-engagement message",
      errorDetail: "More than 24 hours have passed since the customer last replied",
    });

    expect(result).toBe("delivery_failed");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "delivery_failed",
        error: "meta_status:failed:131047:Re-engagement message",
        metadata: expect.objectContaining({
          meta_error_code: 131047,
          meta_error_title: "Re-engagement message",
          meta_error_detail: "More than 24 hours have passed since the customer last replied",
        }),
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

  it("clears system webhook metadata keys on disconnect cleanup", async () => {
    tenantAgentsMetadata.value = {
      system_webhook_last_messages_update_at: "2026-01-01T00:00:00.000Z",
      system_webhook_last_messages_update_instance: "mc049357old",
      system_webhook_pending_delivery_events: [{ messageId: "X", status: 3, instanceName: "mc", receivedAt: "2026-01-01" }],
      isSystemAgent: true,
    };

    await clearSystemAgentWebhookMetadata();

    expect(tenantAgentsMetadata.value.system_webhook_last_messages_update_at).toBeUndefined();
    expect(tenantAgentsMetadata.value.system_webhook_last_messages_update_instance).toBeUndefined();
    expect(tenantAgentsMetadata.value.system_webhook_pending_delivery_events).toBeUndefined();
    expect(tenantAgentsMetadata.value.isSystemAgent).toBe(true);
  });
});
