import { describe, expect, it } from "vitest";
import { labAgentTurnState, labStepVerdict } from "@/lib/agent-test-lab/turn-policy";
import { LAB_AGENT_TURN_MAX_WAIT_SECONDS, LAB_AGENT_TURN_QUIET_SECONDS } from "@/lib/agent-test-lab/contracts";

const sent = "2026-09-09T12:00:00.000Z";
const at = (seconds: number) => Date.parse(sent) + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

describe("laboratory turn boundary", () => {
  it("keeps waiting while the provider is merely slow", () => {
    // The known Evolution burst delay is around a minute. Treating it as failure
    // would report a working agent as broken.
    for (const seconds of [1, 30, 65, 120, LAB_AGENT_TURN_MAX_WAIT_SECONDS - 1]) {
      expect(labAgentTurnState({ confirmedAt: sent, agentMessageTimes: [], now: at(seconds) }))
        .toEqual({ state: "waiting", messages: 0 });
    }
  });

  it("only calls silence at the deadline", () => {
    expect(labAgentTurnState({ confirmedAt: sent, agentMessageTimes: [], now: at(LAB_AGENT_TURN_MAX_WAIT_SECONDS) }).state).toBe("timed_out");
  });

  it("reads a burst as one turn instead of several", () => {
    const burst = [iso(70), iso(72), iso(75)];
    expect(labAgentTurnState({ confirmedAt: sent, agentMessageTimes: burst, now: at(80) }))
      .toEqual({ state: "waiting", messages: 3 });
    expect(labAgentTurnState({ confirmedAt: sent, agentMessageTimes: burst, now: at(75 + LAB_AGENT_TURN_QUIET_SECONDS) }))
      .toEqual({ state: "complete", messages: 3 });
  });

  it("ignores messages that predate the tester's own message", () => {
    // A history sync or an earlier turn must never count as this turn's answer.
    expect(labAgentTurnState({ confirmedAt: sent, agentMessageTimes: [iso(-600), iso(-1)], now: at(10) }))
      .toEqual({ state: "waiting", messages: 0 });
  });

  it("does not settle a turn that is still open", () => {
    expect(labStepVerdict("reply", { state: "waiting", messages: 0 }).verdict).toBe("not_executed");
    expect(labStepVerdict("reply", { state: "waiting", messages: 2 }).verdict).toBe("not_executed");
  });

  it("treats intended silence as an expected block, and a reply to it as a failure", () => {
    expect(labStepVerdict("silence", { state: "timed_out", messages: 0 })).toEqual({ verdict: "expected_block", code: "silence_confirmed" });
    expect(labStepVerdict("silence", { state: "complete", messages: 1 }).verdict).toBe("failed");
  });

  it("approves a plain reply but never an effect", () => {
    expect(labStepVerdict("reply", { state: "complete", messages: 1 }).verdict).toBe("passed");
    // "Agendado" in the reply text is not proof that anything was scheduled.
    for (const expectation of ["agenda_created", "agenda_cancelled", "follow_up", "reminder", "media_understood"] as const) {
      expect(labStepVerdict(expectation, { state: "complete", messages: 1 }))
        .toEqual({ verdict: "inconclusive", code: "awaiting_effect_verification" });
    }
  });

  it("fails an effect expectation when the agent said nothing at all", () => {
    expect(labStepVerdict("agenda_created", { state: "timed_out", messages: 0 }).verdict).toBe("failed");
  });

  it("survives an unparseable timestamp instead of guessing a result", () => {
    expect(labAgentTurnState({ confirmedAt: "not-a-date", agentMessageTimes: [], now: at(9999) }).state).toBe("waiting");
    expect(labAgentTurnState({ confirmedAt: sent, agentMessageTimes: ["nonsense"], now: at(10) }).messages).toBe(0);
  });
});
