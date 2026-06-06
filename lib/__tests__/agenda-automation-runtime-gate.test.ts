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
  ])("uses resolveAgendaTurn with safe reply in the %s", (_label, path) => {
    const source = readRuntimeSource(path);

    expect(source).toContain("AGENDA_AUTOMATION_DISABLED_REPLY");
    expect(source).toContain("resolveAgendaTurn");
    expect(source).toContain("priorAgendaAssistantTextFromMessages");
    expect(source).toContain("priorAssistantText");
    expect(source).toContain('agendaTurn.action === "blocked"');
    expect(source).toContain("shouldDeferHandoffForAgendaResult");
  });
});
