import { beforeEach, describe, expect, it, vi } from "vitest";

const selectChain = vi.hoisted(() => ({
  eq: vi.fn(),
  filter: vi.fn(),
  contains: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  lt: vi.fn(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
}));

const updateMock = vi.hoisted(() => vi.fn());

function resetSelectChain(final: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  selectChain.eq.mockReturnValue(selectChain);
  selectChain.filter.mockReturnValue(selectChain);
  selectChain.contains.mockReturnValue(selectChain);
  selectChain.order.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue(final);
  selectChain.lt.mockReturnValue(selectChain);
  selectChain.maybeSingle.mockResolvedValue({ data: null, error: null });
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
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
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
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      return { select: () => selectChain };
    },
  }),
}));

import {
  markSystemNotificationServerAck,
  reconcileStalePendingNotifications,
} from "@/lib/server/system-agent";

describe("system notification delivery helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("reconciles stale pending notifications to delivery_failed", async () => {
    selectChain.eq.mockReturnValue({
      lt: () => ({
        limit: () =>
          Promise.resolve({
            data: [{ id: "old-1", metadata: {} }],
            error: null,
          }),
      }),
    });

    const count = await reconcileStalePendingNotifications(60);
    expect(count).toBe(1);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "delivery_failed",
        error: "delivery_timeout",
      }),
    );
  });
});
