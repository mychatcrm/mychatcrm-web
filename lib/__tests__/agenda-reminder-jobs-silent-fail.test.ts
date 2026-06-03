import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/google-calendar-db", () => ({
  getAgendaEventById: vi.fn().mockResolvedValue({
    id: "evt-1",
    title: "Visita",
    start_at: "2099-06-02T17:00:00.000Z",
    end_at: "2099-06-02T18:00:00.000Z",
    status: "pending",
    location: null,
  }),
}));

import { scheduleAgendaRemindersForEvent } from "@/lib/server/agenda-reminder-jobs";

describe("scheduleAgendaRemindersForEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails silently when agenda_reminder_jobs table is missing", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "relation does not exist" } });
    const sb = { from: vi.fn(() => ({ insert })) };

    const inserted = await scheduleAgendaRemindersForEvent({
      sb: sb as never,
      tenantId: "t1",
      agentId: "agent-1",
      remoteJid: "5511999990000@s.whatsapp.net",
      leadId: null,
      agendaEventId: "evt-1",
      agendaLembretes: {
        ativo: true,
        regras: [{ offsetValor: 1, offsetUnidade: "dias" }],
      },
      timezone: "America/Sao_Paulo",
    });

    expect(inserted).toBe(0);
    expect(insert).toHaveBeenCalled();
  });
});
