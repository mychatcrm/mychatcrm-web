import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SAFE_REPLY =
  "Posso consultar seus compromissos existentes, mas não consigo criar, remarcar ou cancelar agendamentos por aqui no momento.";

function readRuntimeSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("agenda automation runtime gate", () => {
  it.each([
    ["immediate Evolution webhook", "app/api/webhooks/evolution/route.ts"],
    ["Smart Wait Evolution job", "lib/server/evolution-agent-reply.ts"],
  ])("replaces blocked agenda directives with a safe reply in the %s", (_label, path) => {
    const source = readRuntimeSource(path);

    expect(source).toContain(SAFE_REPLY);
    expect(source).toContain('preparedAgenda.action === "blocked"');
    expect(source).toContain("? AGENDA_AUTOMATION_DISABLED_REPLY");
    expect(source).toContain('reason: preparedAgenda.action === "blocked" ? "automation_disabled"');
  });
});
