import { describe, expect, it } from "vitest";
import { decideWatchdogNotification } from "../../scripts/agent-runtime-watchdog.mjs";

describe("external agent runtime watchdog", () => {
  const now = Date.parse("2026-08-30T12:30:00.000Z");

  it("alerts on a healthy to unhealthy transition", () => {
    expect(decideWatchdogNotification({
      healthy: false,
      now,
      previousRuns: [{ conclusion: "success", created_at: "2026-08-30T12:25:00.000Z" }],
    })).toBe("failure");
  });

  it("does not repeat inside the same incident hour", () => {
    expect(decideWatchdogNotification({
      healthy: false,
      now,
      previousRuns: [{ conclusion: "failure", created_at: "2026-08-30T12:25:00.000Z" }],
    })).toBeNull();
  });

  it("repeats once the incident enters a new hour", () => {
    expect(decideWatchdogNotification({
      healthy: false,
      now: Date.parse("2026-08-30T13:30:00.000Z"),
      previousRuns: [
        { conclusion: "failure", created_at: "2026-08-30T12:25:00.000Z" },
        { conclusion: "failure", created_at: "2026-08-30T11:20:00.000Z" },
      ],
    })).toBe("repeat");
  });

  it("sends recovery only after a failed run", () => {
    expect(decideWatchdogNotification({
      healthy: true,
      now,
      previousRuns: [{ conclusion: "failure", created_at: "2026-08-30T12:25:00.000Z" }],
    })).toBe("recovery");
    expect(decideWatchdogNotification({
      healthy: true,
      now,
      previousRuns: [{ conclusion: "success", created_at: "2026-08-30T12:25:00.000Z" }],
    })).toBeNull();
  });
});
