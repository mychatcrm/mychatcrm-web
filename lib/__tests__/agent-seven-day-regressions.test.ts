import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildAgendaCalendarFacts } from "@/lib/agents/agenda-calendar-facts";
import { computeAgentResponseProcessorDeadline, reclaimStuckProcessingJobs } from "@/lib/server/agent-response-jobs";
import { AGENDA_DATETIME_NEEDED_REPLY, localizeAgendaReply } from "@/lib/server/agent-cta-scheduler";

describe("seven-day incident regressions", () => {
  it.each(Intl.supportedValuesOf("timeZone"))("supplies consecutive civil dates in %s without choosing availability", zone => {
    for (const instant of ["2026-03-08T06:59:00Z", "2026-11-01T05:59:00Z", "2028-02-29T23:59:00Z"]) {
      const facts = buildAgendaCalendarFacts(zone, new Date(instant))!;
      const data = JSON.parse(facts.slice(facts.indexOf("{")));
      expect(data.timezone).toBe(zone);
      expect(data.days).toHaveLength(15);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
      expect(data.days[0].date).toBe(today);
      data.days.forEach((day: { date: string; weekday: number }, index: number) => {
        expect(new Date(day.date).getUTCDay()).toBe(day.weekday);
        expect(Date.parse(day.date) - Date.parse(data.days[0].date)).toBe(index * 86400000);
      });
      expect(facts).not.toMatch(/14:00|availableSlots|preferredSlot/);
    }
  });
  it("does not invent a timezone or date for invalid configuration", () => {
    expect(buildAgendaCalendarFacts("invalid")).toBeNull();
    expect(buildAgendaCalendarFacts("UTC", new Date(NaN))).toBeNull();
  });
  it.each([120000, 180000])("respects the actual route budget %i", invocationBudgetMs => {
    const start = new Date("2026-09-01T10:00:00Z");
    expect(computeAgentResponseProcessorDeadline({ invocationStartedAt: start,
      scheduledFor: "2026-09-01T11:00:00Z", maxWaitUntil: "2026-09-01T11:00:00Z", invocationBudgetMs }))
      .toBe(start.getTime() + invocationBudgetMs - 30000);
  });
  it.each(["pt", "en", "es", "fr", "de", "it", "ar", "ja", "zh", "hi", "ru"])("clarification in %s never proposes a fixed example date", language => {
    const reply = localizeAgendaReply(AGENDA_DATETIME_NEEDED_REPLY, null, language);
    expect(reply).not.toMatch(/\d{1,2}\/\d{1,2}|14h/);
    if (language !== "pt") expect(reply).not.toBe(AGENDA_DATETIME_NEEDED_REPLY);
  });
  it("only recovers expired processing claims and terminates exhausted ones", async () => {
    const q: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of ["update", "eq", "or", "lt", "gte"]) q[name] = vi.fn(() => q);
    q.select = vi.fn(async () => ({ data: [{ id: "synthetic-job" }], error: null }));
    const sb = { from: vi.fn(() => q) };
    expect(await reclaimStuckProcessingJobs(sb as never)).toBe(1);
    expect(q.eq).toHaveBeenNthCalledWith(1, "status", "processing");
    expect(q.eq).toHaveBeenNthCalledWith(2, "status", "processing");
    expect(q.or.mock.calls.every(([filter]) => filter.includes("claim_expires_at.lt.") && filter.includes("locked_at.lt."))).toBe(true);
    expect(q.update.mock.calls[1][0]).toMatchObject({ status: "failed", failed_reason: "response_retry_exhausted", claim_token: null });
    expect(q.lt).toHaveBeenCalledWith("attempt_count", expect.any(Number));
    expect(q.gte).toHaveBeenCalledWith("attempt_count", q.lt.mock.calls[0][1]);
  });
  it("next follow-up retains confirmation and exact response identity without historical replay", () => {
    const sql = readFileSync("supabase/migrations/20260909004226_repair_followup_chain_and_response_recovery.sql", "utf8");
    expect(sql).toContain("v_job.response_confirmed_at, v_job.source_response_job_id, v_job.source_generation");
    expect(sql).toContain("response_confirmation_required");
    expect(sql).toContain("claim_expires_at > v_now");
    expect(sql).not.toMatch(/update public\.follow_up_jobs[\s\S]*where status = 'cancelled'/i);
  });
});
