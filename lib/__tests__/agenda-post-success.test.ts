import { describe, expect, it, vi, beforeEach } from "vitest";

const markWaitingForHumanMock = vi.fn();
const scheduleAgendaRemindersForEventMock = vi.fn();
const cancelAgendaRemindersForEventMock = vi.fn();

vi.mock("@/lib/server/conversation-operation", () => ({
  markWaitingForHuman: (...args: unknown[]) => markWaitingForHumanMock(...args),
}));

vi.mock("@/lib/server/agenda-reminder-jobs", () => ({
  scheduleAgendaRemindersForEvent: (...args: unknown[]) => scheduleAgendaRemindersForEventMock(...args),
  cancelAgendaRemindersForEvent: (...args: unknown[]) => cancelAgendaRemindersForEventMock(...args),
}));

import {
  applyAgendaPostSuccessEffects,
  cancelPendingSilenceFollowUpJobs,
} from "@/lib/server/agenda-post-success";

describe("agenda-post-success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleAgendaRemindersForEventMock.mockResolvedValue(2);
    cancelAgendaRemindersForEventMock.mockResolvedValue(undefined);
    markWaitingForHumanMock.mockResolvedValue(undefined);
  });

  it("triggers handoff after schedule when ctaHandoffAtivo is true", async () => {
    const sb = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    };

    const result = await applyAgendaPostSuccessEffects({
      sb: sb as never,
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      leadId: "lead-1",
      agentId: "agent-1",
      action: "scheduled",
      eventId: "evt-1",
      timezone: "America/Sao_Paulo",
      ctaHandoffAtivo: true,
      handoffNumero: "5511888888888",
      agendaLembretes: { ativo: true, regras: [{ offsetValor: 1, offsetUnidade: "dias" }] },
    });

    expect(result.scheduleHandoffTriggered).toBe(true);
    expect(markWaitingForHumanMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "schedule_confirmed", tenantId: "t1" }),
    );
    expect(scheduleAgendaRemindersForEventMock).toHaveBeenCalled();
  });

  it("does not handoff when ctaHandoffAtivo is false", async () => {
    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: "j1" }], error: null }),
    };
    const sb = {
      from: vi.fn(() => ({
        update: vi.fn(() => updateChain),
      })),
    };

    await applyAgendaPostSuccessEffects({
      sb: sb as never,
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      leadId: null,
      agentId: "agent-1",
      action: "scheduled",
      eventId: "evt-1",
      timezone: "America/Sao_Paulo",
      ctaHandoffAtivo: false,
      handoffNumero: null,
      agendaLembretes: null,
    });

    expect(markWaitingForHumanMock).not.toHaveBeenCalled();
    expect(updateChain.eq).toHaveBeenCalledWith("follow_up_type", "silence");
  });

  it("skips handoff when handoffAlreadyTriggered is true", async () => {
    const sb = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    };

    const result = await applyAgendaPostSuccessEffects({
      sb: sb as never,
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      leadId: "lead-1",
      agentId: "agent-1",
      action: "scheduled",
      eventId: "evt-1",
      timezone: "America/Sao_Paulo",
      ctaHandoffAtivo: true,
      handoffNumero: null,
      agendaLembretes: null,
      handoffAlreadyTriggered: true,
    });

    expect(result.scheduleHandoffTriggered).toBe(false);
    expect(markWaitingForHumanMock).not.toHaveBeenCalled();
  });

  it("triggers handoff after cancel when ctaHandoffAtivo is true", async () => {
    const sb = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    };

    const result = await applyAgendaPostSuccessEffects({
      sb: sb as never,
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      leadId: "lead-1",
      agentId: "agent-1",
      action: "cancelled",
      eventId: "evt-1",
      timezone: "America/Sao_Paulo",
      ctaHandoffAtivo: true,
      handoffNumero: "5511888888888",
      agendaLembretes: null,
    });

    expect(result.scheduleHandoffTriggered).toBe(true);
    expect(markWaitingForHumanMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "schedule_confirmed" }),
    );
  });

  it("passes previousEventId when rescheduling reminders", async () => {
    const sb = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    };

    await applyAgendaPostSuccessEffects({
      sb: sb as never,
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      leadId: "lead-1",
      agentId: "agent-1",
      action: "rescheduled",
      eventId: "evt-new",
      previousEventId: "evt-old",
      timezone: "America/Sao_Paulo",
      ctaHandoffAtivo: false,
      handoffNumero: null,
      agendaLembretes: { ativo: true, regras: [{ offsetValor: 1, offsetUnidade: "dias" }] },
    });

    expect(scheduleAgendaRemindersForEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agendaEventId: "evt-new",
        cancelPreviousEventId: "evt-old",
      }),
    );
  });

  it("cancelPendingSilenceFollowUpJobs scopes by tenant and silence type", async () => {
    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: "j1" }], error: null }),
    };
    const sb = {
      from: vi.fn(() => ({
        update: vi.fn(() => updateChain),
      })),
    };

    const count = await cancelPendingSilenceFollowUpJobs({
      sb: sb as never,
      tenantId: "t1",
      remoteJid: "5511999990000@s.whatsapp.net",
      reason: "agenda_confirmed",
    });

    expect(count).toBe(1);
    expect(updateChain.eq).toHaveBeenCalledWith("tenant_id", "t1");
    expect(updateChain.eq).toHaveBeenCalledWith("follow_up_type", "silence");
  });
});
