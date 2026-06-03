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
  ])("executes agenda before outbound in the %s", (_label, path) => {
    const source = readRuntimeSource(path);

    expect(source).toContain("executeAgendaDirectivesBeforeOutbound");
    expect(source).toContain("applyAgendaPostSuccessEffects");
    expect(source).toContain("agendaToolContext");
  });
});
