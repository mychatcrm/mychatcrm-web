import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("follow-up agenda gate", () => {
  it("rechecks conventional jobs without changing human-abandoned lifecycle", () => {
    const source = readFileSync(join(process.cwd(), "lib/server/follow-up-jobs.ts"), "utf8");
    expect(source).toContain("if (!isHumanAbandonedJob)");
    expect(source).toContain('last_error: "active_agenda_event"');
    expect(source).toContain("settings.intervaloVerificacaoMinutos");
  });
});
