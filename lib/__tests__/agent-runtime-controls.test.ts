import { describe, expect, it, vi } from "vitest";

import { getAgentRuntimeSubsystemControl } from "@/lib/server/agent-runtime-controls";

describe("tenant agent runtime kill switches", () => {
  it("returns the exact service-role control", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        subsystem: "follow_up",
        mode: "shadow",
        enabled: true,
        updated_at: "2026-08-30T12:00:00.000Z",
      }],
      error: null,
    });

    await expect(getAgentRuntimeSubsystemControl({
      sb: { rpc } as never,
      tenantId: "tenant-1",
      subsystem: "follow_up",
    })).resolves.toEqual({
      subsystem: "follow_up",
      mode: "shadow",
      enabled: true,
      updatedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_agent_runtime_subsystem_control_v1",
      { p_tenant_id: "tenant-1", p_subsystem: "follow_up" },
    );
  });

  it("fails closed when the database decision is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    await expect(getAgentRuntimeSubsystemControl({
      sb: { rpc } as never,
      tenantId: "tenant-1",
      subsystem: "agenda_reminder",
    })).resolves.toEqual({
      subsystem: "agenda_reminder",
      mode: "disabled",
      enabled: false,
      updatedAt: null,
    });
  });

  it("ignores enabled-looking data whenever the RPC reports an error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ mode: "enabled", enabled: true, updated_at: "2026-08-30T12:00:00.000Z" }],
      error: {},
    });

    await expect(getAgentRuntimeSubsystemControl({
      sb: { rpc } as never,
      tenantId: "tenant-1",
      subsystem: "follow_up",
    })).resolves.toEqual({
      subsystem: "follow_up",
      mode: "disabled",
      enabled: false,
      updatedAt: null,
    });
  });

  it.each([
    ["enabled", true, true],
    ["enabled", false, false],
    ["shadow", true, true],
    ["shadow", false, false],
    ["disabled", true, false],
    ["disabled", false, false],
  ] as const)("normalizes mode=%s and enabled=%s", async (mode, enabled, expected) => {
    const updatedAt = "2026-08-30T12:34:56.000Z";
    const result = await getAgentRuntimeSubsystemControl({
      sb: { rpc: vi.fn().mockResolvedValue({
        data: [{ mode, enabled, updated_at: updatedAt }],
        error: null,
      }) } as never,
      tenantId: "tenant-1",
      subsystem: "agenda",
    });
    expect(result).toEqual({
      subsystem: "agenda",
      mode,
      enabled: expected,
      updatedAt,
    });
  });

  it.each([null, [], [{}], [{ mode: "invalid", enabled: true }], "invalid"])(
    "fails closed for malformed RPC data: %j",
    async (data) => {
      await expect(getAgentRuntimeSubsystemControl({
        sb: { rpc: vi.fn().mockResolvedValue({ data, error: null }) } as never,
        tenantId: "tenant-1",
        subsystem: "agenda",
      })).resolves.toEqual({
        subsystem: "agenda",
        mode: "disabled",
        enabled: false,
        updatedAt: null,
      });
    },
  );

  it("rejects non-string timestamps without changing the decision", async () => {
    await expect(getAgentRuntimeSubsystemControl({
      sb: { rpc: vi.fn().mockResolvedValue({
        data: [{ mode: "enabled", enabled: true, updated_at: 123 }],
        error: null,
      }) } as never,
      tenantId: "tenant-1",
      subsystem: "follow_up",
    })).resolves.toEqual({
      subsystem: "follow_up",
      mode: "enabled",
      enabled: true,
      updatedAt: null,
    });
  });

  it.each([null, false, 0, {}, []])(
    "never treats a non-boolean enabled value as permission: %j",
    async (enabled) => {
      await expect(getAgentRuntimeSubsystemControl({
        sb: { rpc: vi.fn().mockResolvedValue({
          data: [{ mode: "enabled", enabled, updated_at: null }],
          error: null,
        }) } as never,
        tenantId: "tenant-1",
        subsystem: "agenda",
      })).resolves.toMatchObject({ enabled: false });
    },
  );
});
