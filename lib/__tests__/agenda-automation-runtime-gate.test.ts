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
    expect(source).toContain("operationKey:");
  });

  it("uses the inbound Evolution message id as the immediate idempotency key", () => {
    const source = readRuntimeSource("app/api/webhooks/evolution/route.ts");

    expect(source).toContain("msg.messageId");
    expect(source).toContain("`evolution:${row.tenant_id}:${msg.messageId}`");
  });

  it("uses job, generation and unit as the Smart Wait idempotency key", () => {
    const source = readRuntimeSource("lib/server/evolution-agent-reply.ts");

    expect(source).toContain("`agent-response-job:${job.id}:${generation}:${unitIndex}`");
  });
});
