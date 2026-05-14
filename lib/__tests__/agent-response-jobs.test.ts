import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SMART_WAIT, sanitizeAgentSmartWaitSettings } from "@/lib/agents/smart-wait-settings";
import {
  buildGroupedUserPrompt,
  deduplicateInboundTexts,
  normalizeInboundTextForDedupe,
} from "@/lib/conversas/inbound-message-dedupe";
import { computeAgentResponseSchedule } from "@/lib/server/agent-response-schedule";

describe("agent smart wait schedule", () => {
  it("schedules first inbound message after initial window", () => {
    const first = new Date("2026-05-14T10:00:00.000Z");
    const { scheduledFor, maxWaitUntil } = computeAgentResponseSchedule({
      now: first,
      firstMessageAt: first,
      lastMessageAt: first,
      inboundMessageCount: 1,
      settings: DEFAULT_AGENT_SMART_WAIT,
    });
    expect(scheduledFor.toISOString()).toBe("2026-05-14T10:00:05.000Z");
    expect(maxWaitUntil.toISOString()).toBe("2026-05-14T10:00:30.000Z");
  });

  it("reschedules second inbound message to follow-up window", () => {
    const first = new Date("2026-05-14T10:00:00.000Z");
    const second = new Date("2026-05-14T10:00:03.000Z");
    const { scheduledFor } = computeAgentResponseSchedule({
      now: second,
      firstMessageAt: first,
      lastMessageAt: second,
      inboundMessageCount: 2,
      settings: DEFAULT_AGENT_SMART_WAIT,
    });
    expect(scheduledFor.toISOString()).toBe("2026-05-14T10:00:13.000Z");
  });

  it("does not exceed max wait from first message", () => {
    const first = new Date("2026-05-14T10:00:00.000Z");
    const last = new Date("2026-05-14T10:00:25.000Z");
    const { scheduledFor, maxWaitUntil } = computeAgentResponseSchedule({
      now: last,
      firstMessageAt: first,
      lastMessageAt: last,
      inboundMessageCount: 5,
      settings: DEFAULT_AGENT_SMART_WAIT,
    });
    expect(scheduledFor.getTime()).toBe(maxWaitUntil.getTime());
    expect(scheduledFor.toISOString()).toBe("2026-05-14T10:00:30.000Z");
  });
});

describe("inbound message dedupe", () => {
  it("normalizes repeated greetings and duplicate questions", () => {
    expect(normalizeInboundTextForDedupe("  Oi ")).toBe(normalizeInboundTextForDedupe("oi"));
    expect(normalizeInboundTextForDedupe("BOM   DIA")).toBe(normalizeInboundTextForDedupe("bom dia"));
  });

  it("deduplicates identical consecutive texts", () => {
    const { messages, dedupedCount } = deduplicateInboundTexts([
      { id: "1", content: "oi" },
      { id: "2", content: "oi" },
      { id: "3", content: "queria saber preço" },
    ]);
    expect(messages).toHaveLength(2);
    expect(dedupedCount).toBe(1);
  });

  it("groups different questions into one consolidated prompt", () => {
    const grouped = buildGroupedUserPrompt([
      { id: "1", content: "oi" },
      { id: "2", content: "bom dia" },
      { id: "3", content: "queria saber preço" },
      { id: "4", content: "tem vaga?" },
    ]);
    expect(grouped).toContain("1. oi");
    expect(grouped).toContain("4. tem vaga?");
  });
});

describe("smart wait settings", () => {
  it("keeps defaults when fields are missing", () => {
    expect(sanitizeAgentSmartWaitSettings(null)).toEqual(DEFAULT_AGENT_SMART_WAIT);
  });
});
