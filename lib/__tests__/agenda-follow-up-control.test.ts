import { beforeEach, describe, expect, it, vi } from "vitest";

const { findNextActiveAgendaEventMock } = vi.hoisted(() => ({
  findNextActiveAgendaEventMock: vi.fn(),
}));

vi.mock("@/lib/server/agent-cta-scheduler", () => ({
  detectAgendaCancelIntent: (text: string) => /\b(cancelar|desmarcar)\b/i.test(text),
  detectRescheduleIntent: (text: string) => /\b(remarcar|reagendar|trocar)\b/i.test(text),
  findNextActiveAgendaEvent: findNextActiveAgendaEventMock,
}));

import {
  recordAgendaFollowUpReactivationForInbound,
  shouldSuppressConventionalFollowUpForAgenda,
} from "@/lib/server/agenda-follow-up-control";

function activeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "evt-1",
    tenant_id: "tenant-a",
    google_event_id: null,
    title: "Agendamento",
    description: null,
    location: null,
    color: null,
    start_at: "2026-06-08T15:00:00.000Z",
    end_at: "2026-06-08T16:00:00.000Z",
    all_day: false,
    attendee_name: null,
    attendee_phone: "5511999999999",
    attendee_email: null,
    status: "pending",
    created_by: "agent",
    lead_id: "lead-1",
    agent_id: "agent-1",
    created_at: "2026-06-07T10:00:00.000Z",
    updated_at: "2026-06-07T10:00:00.000Z",
    ...overrides,
  };
}

function mockSupabase(options: {
  latestReactivation?: { id: string; created_at: string } | null;
  lookupError?: { message: string } | null;
  insertError?: { message: string } | null;
} = {}) {
  const query = {
    insert: vi.fn().mockResolvedValue({ error: options.insertError ?? null }),
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({
      data: options.latestReactivation ?? null,
      error: options.lookupError ?? null,
    }),
  };
  return {
    from: vi.fn(() => query),
    query,
  };
}

describe("agenda follow-up control", () => {
  beforeEach(() => {
    findNextActiveAgendaEventMock.mockReset();
  });

  it("keeps legacy suppression when agenda automation is off", async () => {
    findNextActiveAgendaEventMock.mockResolvedValue(activeEvent());
    const sb = mockSupabase();

    const result = await shouldSuppressConventionalFollowUpForAgenda({
      sb: sb as never,
      tenantId: "tenant-a",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentMetadata: { agendaAutomationEnabled: false, ctaHandoffAtivo: false },
    });

    expect(result).toMatchObject({ suppress: true, reason: "active_agenda_event_legacy" });
  });

  it("keeps legacy suppression when handoff is on", async () => {
    findNextActiveAgendaEventMock.mockResolvedValue(activeEvent());
    const sb = mockSupabase();

    const result = await shouldSuppressConventionalFollowUpForAgenda({
      sb: sb as never,
      tenantId: "tenant-a",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentMetadata: { agendaAutomationEnabled: true, ctaHandoffAtivo: true },
    });

    expect(result).toMatchObject({ suppress: true, reason: "active_agenda_event_legacy" });
  });

  it("suppresses common questions while an active agenda event exists", async () => {
    findNextActiveAgendaEventMock.mockResolvedValue(activeEvent());
    const sb = mockSupabase();

    const result = await shouldSuppressConventionalFollowUpForAgenda({
      sb: sb as never,
      tenantId: "tenant-a",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentMetadata: { agendaAutomationEnabled: true, ctaHandoffAtivo: false },
    });

    expect(result).toMatchObject({ suppress: true, reason: "active_agenda_event" });
  });

  it("allows conventional follow-up after a reschedule request signal", async () => {
    findNextActiveAgendaEventMock.mockResolvedValue(activeEvent());
    const sb = mockSupabase({
      latestReactivation: { id: "signal-1", created_at: "2026-06-07T10:05:00.000Z" },
    });

    const result = await shouldSuppressConventionalFollowUpForAgenda({
      sb: sb as never,
      tenantId: "tenant-a",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentMetadata: { agendaAutomationEnabled: true, ctaHandoffAtivo: false },
    });

    expect(result).toMatchObject({
      suppress: false,
      reason: "reactivation_signal_after_active_event",
      reactivationEventId: "signal-1",
    });
  });

  it("suppresses again when the active agenda event is newer than the signal", async () => {
    findNextActiveAgendaEventMock.mockResolvedValue(activeEvent({ created_at: "2026-06-07T10:10:00.000Z" }));
    const sb = mockSupabase({
      latestReactivation: { id: "signal-1", created_at: "2026-06-07T10:05:00.000Z" },
    });

    const result = await shouldSuppressConventionalFollowUpForAgenda({
      sb: sb as never,
      tenantId: "tenant-a",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentMetadata: { agendaAutomationEnabled: true, ctaHandoffAtivo: false },
    });

    expect(result).toMatchObject({
      suppress: true,
      reason: "active_agenda_event_after_reactivation",
    });
  });

  it("allows conventional follow-up when cancellation leaves no active agenda event", async () => {
    findNextActiveAgendaEventMock.mockResolvedValue(null);
    const sb = mockSupabase();

    const result = await shouldSuppressConventionalFollowUpForAgenda({
      sb: sb as never,
      tenantId: "tenant-a",
      remoteJid: "5511999999999@s.whatsapp.net",
      agentMetadata: { agendaAutomationEnabled: true, ctaHandoffAtivo: false },
    });

    expect(result).toMatchObject({ suppress: false, reason: "no_active_agenda_event" });
  });

  it("records reschedule and cancellation signals only in the intended scope", async () => {
    findNextActiveAgendaEventMock.mockResolvedValue(activeEvent());
    const sb = mockSupabase();

    const reschedule = await recordAgendaFollowUpReactivationForInbound({
      sb: sb as never,
      tenantId: "tenant-a",
      agentId: "agent-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      leadId: "lead-1",
      conversationStateId: "state-1",
      agentMetadata: { agendaAutomationEnabled: true, ctaHandoffAtivo: false },
      inboundText: "quero remarcar para outro horário",
    });

    const cancel = await recordAgendaFollowUpReactivationForInbound({
      sb: sb as never,
      tenantId: "tenant-a",
      agentId: "agent-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      leadId: "lead-1",
      conversationStateId: "state-1",
      agentMetadata: { agendaAutomationEnabled: true, ctaHandoffAtivo: false },
      inboundText: "preciso cancelar",
    });

    const commonQuestion = await recordAgendaFollowUpReactivationForInbound({
      sb: sb as never,
      tenantId: "tenant-a",
      agentId: "agent-1",
      remoteJid: "5511999999999@s.whatsapp.net",
      leadId: "lead-1",
      conversationStateId: "state-1",
      agentMetadata: { agendaAutomationEnabled: true, ctaHandoffAtivo: false },
      inboundText: "onde fica?",
    });

    expect(reschedule).toMatchObject({ recorded: true, reason: "reschedule_requested" });
    expect(cancel).toMatchObject({ recorded: true, reason: "cancel_requested" });
    expect(commonQuestion).toMatchObject({ recorded: false, skippedReason: "no_agenda_mutation_signal" });
    expect(sb.query.insert).toHaveBeenCalledTimes(2);
  });
});
