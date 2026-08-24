import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeFollowUpReplyFromResult } from "@/lib/server/follow-up-jobs";

describe("follow-up agenda gate", () => {
  it("rechecks conventional jobs without changing human-abandoned lifecycle", () => {
    const source = readFileSync(join(process.cwd(), "lib/server/follow-up-jobs.ts"), "utf8");
    expect(source).toContain("if (!isHumanAbandonedJob)");
    expect(source).toContain('lastError: "active_agenda_event"');
    expect(source).toContain("finishClaimedFollowUpJob");
    expect(source).toContain("settings.intervaloVerificacaoMinutos");
  });

  it("accepts only a plain structured follow-up without business mutations", () => {
    const base = {
      ok: true as const,
      text: "ignored",
      provider: "openai" as const,
      model: "gpt-4o-mini",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      latencyMs: 1,
      estimatedCostUsd: 0,
      structuredData: {
        reply: "A configured follow-up",
        agenda: { action: "none", date: null, time: null, location: null, eventId: null },
        leadOutcome: { action: "none", reason: null },
        externalApiLookups: [],
      },
    };
    expect(safeFollowUpReplyFromResult(base)).toEqual({
      ok: true,
      reply: "A configured follow-up",
    });
    expect(safeFollowUpReplyFromResult({
      ...base,
      structuredData: {
        ...base.structuredData,
        agenda: { ...base.structuredData.agenda, action: "create" },
      },
    })).toEqual({ ok: false, reason: "follow_up_agenda_action_forbidden" });
    expect(safeFollowUpReplyFromResult({
      ...base,
      structuredData: { ...base.structuredData, reply: "Transfer [[HANDOFF]]" },
    })).toEqual({ ok: false, reason: "follow_up_internal_marker_forbidden" });
  });
});
