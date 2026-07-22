import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_SMART_WAIT,
  evolutionBurstSafeSmartWait,
  evolutionInboundNeedsExtendedInitialWait,
  sanitizeAgentSmartWaitSettings,
} from "@/lib/agents/smart-wait-settings";
import {
  buildGroupedUserPrompt,
  deduplicateInboundTexts,
  normalizeInboundTextForDedupe,
} from "@/lib/conversas/inbound-message-dedupe";
import {
  computeAgentResponseSchedule,
  isJobReadyToProcess,
  isStaleBurstGenerationRow,
} from "@/lib/server/agent-response-schedule";
import {
  computeAgentResponseProcessorDeadline,
  resolveAgentJobSchedulingTimestamp,
} from "@/lib/server/agent-response-jobs";
import { resolveInboundAgentFlowDecision } from "@/lib/server/evolution-webhook-agent-flow";

describe("agent smart wait schedule", () => {
  it.each([
    { kind: "text" as const, text: "Olá", deliveryDelaySeconds: 1 },
    { kind: "text" as const, text: "Book Tuesday at 2pm", deliveryDelaySeconds: 2 },
    { kind: "text" as const, text: "Quiero cancelar", hasPendingAgendaAction: true },
    { kind: "image" as const, text: "[image]" },
  ])("applies the same 65-second Evolution transport guard without inspecting content: $text", (signal) => {
    expect(evolutionBurstSafeSmartWait(DEFAULT_AGENT_SMART_WAIT, signal)).toMatchObject({
      initialSeconds: 65,
      followupSeconds: 65,
      maxSeconds: 65,
    });
    expect(evolutionInboundNeedsExtendedInitialWait(signal)).toBe(true);
  });

  it("does not shorten stricter tenant settings", () => {
    expect(
      evolutionBurstSafeSmartWait({
        ...DEFAULT_AGENT_SMART_WAIT,
        initialSeconds: 90,
        followupSeconds: 80,
        maxSeconds: 240,
      }),
    ).toMatchObject({ initialSeconds: 90, followupSeconds: 80, maxSeconds: 240 });
  });

  it("starts the burst clock when a delayed provider event reaches the webhook", () => {
    expect(
      resolveAgentJobSchedulingTimestamp(
        "2026-05-14T10:00:00.000Z",
        new Date("2026-05-14T10:01:30.000Z"),
      ),
    ).toBe("2026-05-14T10:01:30.000Z");
  });

  it("does not let provider clock skew postpone the burst", () => {
    expect(
      resolveAgentJobSchedulingTimestamp(
        "2026-05-14T12:00:00.000Z",
        new Date("2026-05-14T10:00:00.000Z"),
      ),
    ).toBe("2026-05-14T10:00:00.000Z");
  });

  it("schedules first inbound message after initial window", () => {
    const first = new Date("2026-05-14T10:00:00.000Z");
    const { scheduledFor, maxWaitUntil } = computeAgentResponseSchedule({
      now: first,
      firstMessageAt: first,
      lastMessageAt: first,
      inboundMessageCount: 1,
      settings: DEFAULT_AGENT_SMART_WAIT,
    });
    expect(scheduledFor.toISOString()).toBe("2026-05-14T10:00:07.000Z");
    expect(maxWaitUntil.toISOString()).toBe("2026-05-14T10:01:00.000Z");
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
    const last = new Date("2026-05-14T10:00:55.000Z");
    const { scheduledFor, maxWaitUntil } = computeAgentResponseSchedule({
      now: last,
      firstMessageAt: first,
      lastMessageAt: last,
      inboundMessageCount: 5,
      settings: DEFAULT_AGENT_SMART_WAIT,
    });
    expect(scheduledFor.getTime()).toBe(maxWaitUntil.getTime());
    expect(scheduledFor.toISOString()).toBe("2026-05-14T10:01:00.000Z");
  });
});

describe("processor readiness", () => {
  it("caps an older dispatcher below the Vercel function ceiling", () => {
    expect(
      new Date(
        computeAgentResponseProcessorDeadline({
          invocationStartedAt: new Date("2026-05-14T10:00:00.000Z"),
          scheduledFor: "2026-05-14T10:02:05.000Z",
          maxWaitUntil: "2026-05-14T10:03:00.000Z",
        }),
      ).toISOString(),
    ).toBe("2026-05-14T10:02:30.000Z");
  });

  it("returns before a long rescheduled burst can hit function timeout", () => {
    expect(
      new Date(
        computeAgentResponseProcessorDeadline({
          invocationStartedAt: new Date("2026-05-14T10:00:00.000Z"),
          scheduledFor: "2026-05-14T10:03:00.000Z",
          maxWaitUntil: "2026-05-14T10:02:50.000Z",
        }),
      ).toISOString(),
    ).toBe("2026-05-14T10:02:30.000Z");
  });

  it("does not process before scheduled_for", () => {
    const now = new Date("2026-05-14T10:00:05.000Z");
    expect(isJobReadyToProcess("2026-05-14T10:00:07.000Z", now)).toBe(false);
  });

  it("processes after scheduled_for", () => {
    const now = new Date("2026-05-14T10:00:08.000Z");
    expect(isJobReadyToProcess("2026-05-14T10:00:07.000Z", now)).toBe(true);
  });
});

describe("webhook flow decision", () => {
  it("blocks immediate flow when smart wait is enabled", () => {
    expect(
      resolveInboundAgentFlowDecision({
        smartWait: { ...DEFAULT_AGENT_SMART_WAIT, enabled: true },
        inboundMessageKey: "msg-1",
      }).mode,
    ).toBe("smart_wait");
  });

  it("keeps the durable grouping pipeline even for legacy disabled settings", () => {
    expect(
      resolveInboundAgentFlowDecision({
        smartWait: { ...DEFAULT_AGENT_SMART_WAIT, enabled: false },
        inboundMessageKey: "msg-1",
      }),
    ).toEqual({ mode: "smart_wait", jobId: null });
  });
});

describe("inbound message dedupe", () => {
  it("normalizes repeated greetings and duplicate questions", () => {
    expect(normalizeInboundTextForDedupe("  Oi ")).toBe(normalizeInboundTextForDedupe("oi"));
    expect(normalizeInboundTextForDedupe("BOM   DIA")).toBe(normalizeInboundTextForDedupe("bom dia"));
  });

  it("deduplicates three identical oi into one", () => {
    const { messages, dedupedCount } = deduplicateInboundTexts([
      { id: "1", content: "oi" },
      { id: "2", content: "oi" },
      { id: "3", content: "oi" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("oi");
    expect(dedupedCount).toBe(2);
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

describe("staleness de geração (barreira final antes de mutação/envio)", () => {
  it("geração divergente é stale (mensagem mais nova chegou)", () => {
    expect(isStaleBurstGenerationRow({ burst_generation: 2, status: "processing" }, 1)).toBe(true);
  });

  it("mesma geração e job ativo não é stale", () => {
    expect(isStaleBurstGenerationRow({ burst_generation: 3, status: "processing" }, 3)).toBe(false);
  });

  it("job cancelado é stale mesmo com a mesma geração", () => {
    expect(isStaleBurstGenerationRow({ burst_generation: 3, status: "cancelled" }, 3)).toBe(true);
  });

  it("job inexistente é stale", () => {
    expect(isStaleBurstGenerationRow(null, 1)).toBe(true);
    expect(isStaleBurstGenerationRow(undefined, 1)).toBe(true);
  });

  it("generation ausente conta como 1", () => {
    expect(isStaleBurstGenerationRow({ status: "processing" }, 1)).toBe(false);
    expect(isStaleBurstGenerationRow({ status: "processing" }, 2)).toBe(true);
  });
});
