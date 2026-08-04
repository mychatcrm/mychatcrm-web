import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgendaCrmMoveTarget } from "@/lib/server/agenda-crm-move";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const FULL_CONFIG = {
  agendaAutomationEnabled: true,
  agendaCrmMoveOnScheduleEnabled: true,
  agendaCrmScheduleFunnelId: "funil-vendas",
  agendaCrmScheduleColumnId: "agendado",
  agendaCrmMoveOnCancelEnabled: true,
  agendaCrmCancelFunnelId: "funil-vendas",
  agendaCrmCancelColumnId: "perdido",
};

describe("resolveAgendaCrmMoveTarget", () => {
  it("does not move anything when the agent cannot touch the agenda", () => {
    const metadata = { ...FULL_CONFIG, agendaAutomationEnabled: false };
    expect(resolveAgendaCrmMoveTarget(metadata, "scheduled")).toBeNull();
    expect(resolveAgendaCrmMoveTarget(metadata, "cancelled")).toBeNull();
  });

  it("resolves the schedule target when scheduling", () => {
    expect(resolveAgendaCrmMoveTarget(FULL_CONFIG, "scheduled")).toEqual({
      funnelId: "funil-vendas",
      columnId: "agendado",
    });
  });

  it("reuses the schedule target when rescheduling", () => {
    expect(resolveAgendaCrmMoveTarget(FULL_CONFIG, "rescheduled")).toEqual(
      resolveAgendaCrmMoveTarget(FULL_CONFIG, "scheduled"),
    );
  });

  it("resolves the cancel target when cancelling", () => {
    expect(resolveAgendaCrmMoveTarget(FULL_CONFIG, "cancelled")).toEqual({
      funnelId: "funil-vendas",
      columnId: "perdido",
    });
  });

  it("leaves the card alone when only one side is configured", () => {
    const scheduleOnly = { ...FULL_CONFIG, agendaCrmMoveOnCancelEnabled: false };
    expect(resolveAgendaCrmMoveTarget(scheduleOnly, "scheduled")).not.toBeNull();
    expect(resolveAgendaCrmMoveTarget(scheduleOnly, "cancelled")).toBeNull();

    const cancelOnly = { ...FULL_CONFIG, agendaCrmMoveOnScheduleEnabled: false };
    expect(resolveAgendaCrmMoveTarget(cancelOnly, "cancelled")).not.toBeNull();
    expect(resolveAgendaCrmMoveTarget(cancelOnly, "scheduled")).toBeNull();
    expect(resolveAgendaCrmMoveTarget(cancelOnly, "rescheduled")).toBeNull();
  });

  it("refuses incomplete configuration instead of moving to an empty column", () => {
    expect(
      resolveAgendaCrmMoveTarget({ ...FULL_CONFIG, agendaCrmScheduleColumnId: "  " }, "scheduled"),
    ).toBeNull();
    expect(
      resolveAgendaCrmMoveTarget({ ...FULL_CONFIG, agendaCrmCancelFunnelId: null }, "cancelled"),
    ).toBeNull();
  });

  it("handles agents saved before this feature existed", () => {
    expect(resolveAgendaCrmMoveTarget({ agendaAutomationEnabled: true }, "scheduled")).toBeNull();
    expect(resolveAgendaCrmMoveTarget(null, "cancelled")).toBeNull();
    expect(resolveAgendaCrmMoveTarget({}, "scheduled")).toBeNull();
  });
});

describe("agenda CRM move wiring contract", () => {
  it("moves the card inside the exactly-once guard, after the agenda is committed", () => {
    const content = source("lib/server/agent-cta-scheduler.ts");
    const guard = content.indexOf("if (atomicResult.changed && !atomicResult.deduplicated)");
    const move = content.indexOf("await applyAgendaCrmMove(", guard);
    const guardEnd = content.indexOf(
      "return { action: syncedResult.action, eventId: syncedResult.event.id };",
      guard,
    );

    expect(guard).toBeGreaterThan(0);
    expect(move).toBeGreaterThan(guard);
    // Dentro do bloco do guard: mover fora dele reintroduziria movimentos
    // duplicados em retries/dedupe da mesma mutação de agenda.
    expect(move).toBeLessThan(guardEnd);
  });

  it("never lets a CRM failure break the agenda mutation", () => {
    const content = source("lib/server/agent-cta-scheduler.ts");
    for (const call of content.split("await applyAgendaCrmMove(").slice(1)) {
      expect(call).toContain(".catch(() => undefined)");
    }
  });

  it("also moves the card when a human cancels from the agenda panel", () => {
    const content = source("app/api/client/google-calendar/events/[id]/route.ts");
    const cancel = content.indexOf("await cancelAgendaEvent(");
    const move = content.indexOf("applyAgendaCrmMove(", cancel);

    expect(cancel).toBeGreaterThan(0);
    expect(move).toBeGreaterThan(cancel);
    expect(content).toContain('action: "cancelled"');
  });
});
