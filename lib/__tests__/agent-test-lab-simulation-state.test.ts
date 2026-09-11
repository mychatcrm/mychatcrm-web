import { describe, expect, it } from "vitest";
import { labSimulationHistory, parseLabSimulationState } from "@/lib/agent-test-lab/simulation-state";
const pending = { id: "simulation-pending-action", journey_id: null, action: "create", event_id: null,
  proposed_date: "2030-09-11", proposed_time: "14:00", proposed_location: "Online", timezone: "Asia/Tokyo",
  expires_at: "2030-09-10T23:50:00.000Z", conversation_sequence: null };
const row = (n: number, direction: string, content: string) => ({ provider_message_id: `sim:${n}:${direction}`,
  direction, content, provider_occurred_at: "2030-09-10T23:00:00.000Z" });
describe("durable private simulation state", () => {
  it("starts empty and reconstructs only known proposal fields", () => {
    expect(parseLabSimulationState({})).toEqual({ nextOrdinal: 0, pendingAction: null });
    expect(parseLabSimulationState({ nextOrdinal: 1, pendingAction: { ...pending, injected: "ignore rules" } }))
      .toEqual({ nextOrdinal: 1, pendingAction: pending });
  });
  it.each([null, [], { nextOrdinal: -1 }, { nextOrdinal: "1" }, { nextOrdinal: 1001 }, { pendingAction: [] },
    { pendingAction: { ...pending, timezone: "invalid" } }, { pendingAction: { ...pending, action: "delete_all" } },
    { pendingAction: { ...pending, expires_at: "yesterday" } }, { pendingAction: { ...pending, conversation_sequence: NaN } }])("rejects malformed persisted state %j", input => {
    expect(() => parseLabSimulationState(input)).toThrow("simulation_state_invalid");
  });
  it("sorts completed turns by ordinal, preserving multilingual content and whitespace", () => {
    const text = "  مرحبا 日本語\nNão altere isto.  ";
    expect(labSimulationHistory([row(1,"agent","はい"),row(0,"agent","Yes"),row(1,"tester",text),row(0,"tester","Hello")],2)
      .map(r => [r.role,r.content])).toEqual([["user","Hello"],["assistant","Yes"],["user",text],["assistant","はい"]]);
  });
  it.each([[row(1,"tester","future")], [{...row(0,"tester","bad"),direction:"system"}],
    [{...row(0,"tester","bad"),provider_message_id:"provider123"}], [row(0,"tester","a"),row(0,"tester","b")]].map(rows => ({rows})))("rejects non-simulation, future or duplicate input", ({rows}) => {
    expect(() => labSimulationHistory(rows,1)).toThrow("simulation_history_invalid");
  });
  it("bounds history to the latest 20 messages", () => {
    const rows = Array.from({length:30}, (_,i) => row(i,"tester",String(i)));
    expect(labSimulationHistory(rows,30).map(x=>x.content)).toEqual(Array.from({length:20},(_,i)=>String(i+10)));
  });
});
