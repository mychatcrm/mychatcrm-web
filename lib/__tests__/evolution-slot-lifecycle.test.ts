import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimLifecycleMock,
  finalizeRemovalMock,
  getSlotMock,
  removeInstanceMock,
} = vi.hoisted(() => ({
  claimLifecycleMock: vi.fn(),
  finalizeRemovalMock: vi.fn(),
  getSlotMock: vi.fn(),
  removeInstanceMock: vi.fn(),
}));

vi.mock("@/lib/integrations/evolution-api", () => ({
  buildFreshEvolutionInstanceName: () => "mc-slot-fresh",
  evolutionRemoveInstanceCompletely: removeInstanceMock,
}));

vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  claimTenantEvolutionInstanceLifecycle: claimLifecycleMock,
  finalizeTenantEvolutionInstanceRemoval: finalizeRemovalMock,
  getEvolutionInstanceByTenantSlot: getSlotMock,
  isEvolutionLifecycleState: (state: string | null | undefined) =>
    state === "provisioning" || state === "deleting" || state === "resetting",
}));

import { removeEvolutionSlotSafely } from "@/lib/server/evolution-slot-lifecycle";

const row = {
  id: "connection-1",
  tenant_id: "tenant-1",
  slot_index: 0,
  instance_name: "mc-slot-old",
  connection_state: "open",
  wa_jid: "5562999999999@s.whatsapp.net",
  default_agent_id: "agent-1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("Evolution slot lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSlotMock.mockResolvedValue(row);
    claimLifecycleMock.mockResolvedValue({ ...row, connection_state: "deleting", updated_at: new Date().toISOString() });
  });

  it("preserves the logical row and finalizes only after verified remote absence", async () => {
    removeInstanceMock.mockResolvedValue({
      ok: true,
      deleted: true,
      verifiedAbsent: true,
      presence: "absent",
      error: null,
      status: 200,
      deleteAttempts: [{ status: 200, error: null }],
    });
    finalizeRemovalMock.mockResolvedValue({
      ...row,
      instance_name: "mc-slot-fresh",
      connection_state: "close",
      wa_jid: null,
    });

    const result = await removeEvolutionSlotSafely({ tenantId: "tenant-1", slotIndex: 0, mode: "deleting" });

    expect(result.state).toBe("complete");
    if (result.state === "complete") {
      expect(result.row.id).toBe("connection-1");
      expect(result.row.instance_name).toBe("mc-slot-fresh");
      expect(result.previousWaJid).toBe(row.wa_jid);
    }
    expect(finalizeRemovalMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      slotIndex: 0,
      previousInstanceName: "mc-slot-old",
      lifecycleState: "deleting",
      nextInstanceName: "mc-slot-fresh",
    });
  });

  it("keeps the lifecycle lock when Evolution cleanup is still pending", async () => {
    removeInstanceMock.mockResolvedValue({
      ok: false,
      deleted: false,
      verifiedAbsent: false,
      presence: "present",
      error: "instance_still_present_after_delete",
      status: 200,
      deleteAttempts: [{ status: 200, error: null }],
    });

    const result = await removeEvolutionSlotSafely({ tenantId: "tenant-1", slotIndex: 0, mode: "deleting" });

    expect(result.state).toBe("pending");
    expect(finalizeRemovalMock).not.toHaveBeenCalled();
  });

  it("does not run a second deletion while a recent request owns the lease", async () => {
    getSlotMock.mockResolvedValue({
      ...row,
      connection_state: "deleting",
      updated_at: new Date().toISOString(),
    });

    const result = await removeEvolutionSlotSafely({ tenantId: "tenant-1", slotIndex: 0, mode: "deleting" });

    expect(result.state).toBe("pending");
    expect(claimLifecycleMock).not.toHaveBeenCalled();
    expect(removeInstanceMock).not.toHaveBeenCalled();
  });

  it("does not replace another lifecycle operation", async () => {
    getSlotMock.mockResolvedValue({
      ...row,
      connection_state: "resetting",
      updated_at: new Date().toISOString(),
    });

    const result = await removeEvolutionSlotSafely({ tenantId: "tenant-1", slotIndex: 0, mode: "deleting" });

    expect(result.state).toBe("busy");
    expect(removeInstanceMock).not.toHaveBeenCalled();
  });
});
