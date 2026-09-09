import { LAB_AGENT_TURN_MAX_WAIT_SECONDS, LAB_AGENT_TURN_QUIET_SECONDS, type LabStepV1, type LabVerdict } from "./contracts";

export type LabTurnState = { state: "waiting" | "complete" | "timed_out"; messages: number };

/** A tester turn is finished when the agent stopped adding messages, not at the first one. */
export function labAgentTurnState(params: { confirmedAt: string; agentMessageTimes: string[]; now: number }): LabTurnState {
  const since = Date.parse(params.confirmedAt);
  if (!Number.isFinite(since)) return { state: "waiting", messages: 0 };
  const times = params.agentMessageTimes
    .map(value => Date.parse(value))
    .filter(value => Number.isFinite(value) && value >= since);
  if (!times.length) {
    // Evolution can hold a burst for around a minute, and the agent adds its own
    // smart wait. Silence becomes a result at the deadline, never before it.
    return { state: params.now >= since + LAB_AGENT_TURN_MAX_WAIT_SECONDS * 1000 ? "timed_out" : "waiting", messages: 0 };
  }
  const last = Math.max(...times);
  return { state: params.now >= last + LAB_AGENT_TURN_QUIET_SECONDS * 1000 ? "complete" : "waiting", messages: times.length };
}

/** Compares one step's expectation with what the run can actually prove so far. */
export function labStepVerdict(
  expected: LabStepV1["expected"]["type"],
  turn: LabTurnState,
): { verdict: LabVerdict; code: string } {
  if (turn.state === "waiting") return { verdict: "not_executed", code: "turn_still_open" };
  if (expected === "silence") {
    return turn.messages === 0
      ? { verdict: "expected_block", code: "silence_confirmed" }
      : { verdict: "failed", code: "silence_expected_but_agent_replied" };
  }
  if (turn.messages === 0) return { verdict: "failed", code: "no_reply_within_window" };
  if (expected === "reply") return { verdict: "passed", code: "reply_received" };
  // Agenda, follow-up, reminder and media expectations are settled by the effect
  // verifier against the database. A reply on its own never approves them.
  return { verdict: "inconclusive", code: "awaiting_effect_verification" };
}
