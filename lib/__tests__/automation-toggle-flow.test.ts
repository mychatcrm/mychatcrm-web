import { describe, expect, it, vi } from "vitest";
import {
  buildOptimisticAutomation,
  buildRollbackAutomation,
  getAutomationConfirmCopy,
  nextAutomationEnabled,
  resolveAutomationConfirmIntent,
  runAutomationToggleCommit,
} from "@/lib/conversas/automation-toggle-flow";

describe("automation toggle confirmation flow", () => {
  it("opens pause intent when automation is active", () => {
    expect(resolveAutomationConfirmIntent(true)).toBe("pause");
    expect(getAutomationConfirmCopy("pause").title).toContain("pausar");
  });

  it("opens resume intent when automation is paused", () => {
    expect(resolveAutomationConfirmIntent(false)).toBe("resume");
    expect(getAutomationConfirmCopy("resume").title).toContain("reativar");
  });

  it("does not commit until confirm maps to next enabled state", () => {
    expect(nextAutomationEnabled("pause")).toBe(false);
    expect(nextAutomationEnabled("resume")).toBe(true);
  });

  it("cancel keeps previous snapshot unchanged via rollback builder", () => {
    const previous = buildOptimisticAutomation(true);
    expect(buildRollbackAutomation(previous)).toEqual(previous);
  });

  it("confirm calls endpoint and returns updated automation", async () => {
    const toggleApi = vi.fn(async () => buildOptimisticAutomation(false));
    const previous = buildOptimisticAutomation(true);

    const result = await runAutomationToggleCommit({
      remoteJid: "5511999999999@s.whatsapp.net",
      nextEnabled: false,
      previous,
      toggleApi,
    });

    expect(toggleApi).toHaveBeenCalledWith("5511999999999@s.whatsapp.net", false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.automation.enabled).toBe(false);
    }
  });

  it("rolls back on endpoint error", async () => {
    const previous = buildOptimisticAutomation(true);
    const result = await runAutomationToggleCommit({
      remoteJid: "5511999999999@s.whatsapp.net",
      nextEnabled: false,
      previous,
      toggleApi: async () => {
        throw new Error("falhou");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rollback).toEqual(previous);
      expect(result.error).toBe("falhou");
    }
  });

  it("optimistic pause state matches manual toggle semantics", () => {
    expect(buildOptimisticAutomation(false)).toMatchObject({
      enabled: false,
      human_paused: true,
      paused_by: "human_manual",
      paused_reason: "manual_toggle",
    });
  });
});
