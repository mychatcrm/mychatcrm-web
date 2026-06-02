import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readRuntimeSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("agenda automation runtime gate", () => {
  it.each([
    ["immediate Evolution webhook", "app/api/webhooks/evolution/route.ts"],
    ["Smart Wait Evolution job", "lib/server/evolution-agent-reply.ts"],
  ])("executes agenda before outbound and gates disabled automation in the %s", (_label, path) => {
    const source = readRuntimeSource(path);

    expect(source).toContain("prepareAndExecuteAgendaBeforeOutbound");
    expect(source).toContain("AGENDA_AUTOMATION_DISABLED_REPLY");
    expect(source).toContain('agendaPrep.prepared.action === "blocked"');
    expect(source).toContain('reason: agendaPrep.prepared.action === "blocked" ? "automation_disabled"');
  });

  it("defines the safe disabled-automation reply in the scheduler module", () => {
    const scheduler = readRuntimeSource("lib/server/agent-cta-scheduler.ts");
    expect(scheduler).toContain("AGENDA_AUTOMATION_DISABLED_REPLY");
    expect(scheduler).toContain(
      "Posso consultar seus compromissos existentes, mas não consigo criar, remarcar ou cancelar agendamentos por aqui no momento.",
    );
    expect(scheduler).toContain("prepareAndExecuteAgendaBeforeOutbound");
    expect(scheduler).toContain('outboundText: AGENDA_AUTOMATION_DISABLED_REPLY');
  });
});
