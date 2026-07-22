import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectionState: vi.fn(),
  ensureSettings: vi.fn(),
  ensureWebhook: vi.fn(),
  fetchInstances: vi.fn(),
  restart: vi.fn(),
  reconcileLive: vi.fn(),
  listOpen: vi.fn(),
}));

vi.mock("@/lib/integrations/evolution-api", () => ({
  evolutionConnectionState: mocks.connectionState,
  evolutionEnsureClientInstanceSettings: mocks.ensureSettings,
  evolutionEnsureWebhook: mocks.ensureWebhook,
  evolutionFetchInstances: mocks.fetchInstances,
  evolutionRestartInstance: mocks.restart,
  normalizeEvolutionConnectionState: (value: unknown, fallback: string) =>
    typeof value === "string" ? value : fallback,
  parseEvolutionConnectionStatePayload: (data: unknown) =>
    (data as { instance?: { state?: string } })?.instance?.state,
  pickEvolutionInstanceInfo: (items: Array<{ name: string }>, name: string) =>
    items.find((item) => item.name === name) ?? null,
}));

vi.mock("@/lib/server/evolution-instance-reconciliation", () => ({
  reconcileLiveEvolutionInstance: mocks.reconcileLive,
}));

vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  isEvolutionLifecycleState: (state: string) =>
    state === "provisioning" || state === "deleting" || state === "resetting",
  listOpenEvolutionInstances: mocks.listOpen,
}));

import { reconcileEvolutionClientHealth } from "@/lib/server/evolution-client-health";

const row = {
  id: "connection-1",
  tenant_id: "tenant-1",
  slot_index: 0,
  instance_name: "mc-instance",
  connection_state: "open",
  wa_jid: "551100000000@s.whatsapp.net",
  default_agent_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("reconcileEvolutionClientHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcileLive.mockResolvedValue({ ok: true, instance: row, adoptedSibling: false });
    mocks.ensureSettings.mockResolvedValue({
      healthy: true,
      reapplied: false,
      reapplyOk: true,
      verified: true,
    });
    mocks.ensureWebhook.mockResolvedValue({ healthy: true, reapplied: false, reapplyOk: true });
    mocks.connectionState.mockResolvedValue({
      ok: true,
      data: { instance: { state: "open" } },
    });
    mocks.fetchInstances.mockResolvedValue({
      ok: true,
      data: [{ name: row.instance_name, ownerJid: row.wa_jid }],
    });
    mocks.restart.mockResolvedValue({ ok: true, status: 200 });
  });

  it("keeps a healthy session untouched", async () => {
    const result = await reconcileEvolutionClientHealth({ row, webhookUrl: "https://crm.test/hook" });

    expect(result).toMatchObject({ healthy: true, restarted: false, identityVerified: true });
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it("restarts exactly once when an old setting was corrected and restart was authorized", async () => {
    mocks.ensureSettings.mockResolvedValue({
      healthy: false,
      reapplied: true,
      reapplyOk: true,
      verified: true,
    });

    const result = await reconcileEvolutionClientHealth({
      row,
      webhookUrl: "https://crm.test/hook",
      restartIfSettingsChanged: true,
    });

    expect(result).toMatchObject({ healthy: true, settingsReapplied: true, restarted: true });
    expect(mocks.restart).toHaveBeenCalledTimes(1);
    expect(mocks.ensureWebhook).toHaveBeenCalledTimes(2);
  });

  it("allows one explicitly targeted maintenance restart after all guards pass", async () => {
    const result = await reconcileEvolutionClientHealth({
      row,
      webhookUrl: "https://crm.test/hook",
      forceTargetedRestart: true,
    });

    expect(result).toMatchObject({ healthy: true, settingsReapplied: false, restarted: true });
    expect(mocks.restart).toHaveBeenCalledTimes(1);
    expect(mocks.ensureWebhook).toHaveBeenCalledTimes(2);
  });

  it("blocks an explicitly targeted restart when the authenticated identity is not verified", async () => {
    mocks.fetchInstances.mockResolvedValue({ ok: true, data: [] });

    const result = await reconcileEvolutionClientHealth({
      row,
      webhookUrl: "https://crm.test/hook",
      forceTargetedRestart: true,
    });

    expect(result).toMatchObject({ healthy: false, restarted: false, identityVerified: false });
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it("never restarts when verification failed", async () => {
    mocks.ensureSettings.mockResolvedValue({
      healthy: false,
      reapplied: true,
      reapplyOk: true,
      verified: false,
    });

    const result = await reconcileEvolutionClientHealth({
      row,
      webhookUrl: "https://crm.test/hook",
      restartIfSettingsChanged: true,
    });

    expect(result.healthy).toBe(false);
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it("does not touch lifecycle-locked sessions", async () => {
    const result = await reconcileEvolutionClientHealth({
      row: { ...row, connection_state: "resetting" },
      webhookUrl: "https://crm.test/hook",
      restartIfSettingsChanged: true,
    });

    expect(result).toMatchObject({ checked: false, healthy: false, error: "lifecycle_operation_in_progress" });
    expect(mocks.reconcileLive).not.toHaveBeenCalled();
    expect(mocks.restart).not.toHaveBeenCalled();
  });
});
