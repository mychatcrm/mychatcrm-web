import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENDA_SLOT_TAKEN_REPLY,
  agendaSyncRetryMinutes,
  assistantTextForSchedulingConfirmation,
  buildOutsideAvailabilityReply,
  createAgendaEventForSchedulingCta,
  detectRescheduleIntent,
  detectSchedulingConfirmation,
  executePreparedAgendaDirective,
  extractLocationFromText,
  formatExistingAppointmentSchedulingBlock,
  isSchedulingCta,
  parseAgendaDirectives,
  prepareAgendaDirectiveInReply,
  stripAgendaDirectives,
  executeAgendaDirective,
} from "@/lib/server/agent-cta-scheduler";

const insertAgendaEventMock = vi.fn();
const updateAgendaEventMock = vi.fn();
const cancelAgendaEventMock = vi.fn();
const getAgendaEventByIdMock = vi.fn();
const getGoogleCalendarTokenMock = vi.fn();
const createGoogleCalendarEventMock = vi.fn();
const cancelGoogleCalendarEventMock = vi.fn();
const broadcastAgendaChangeMock = vi.fn();

vi.mock("@/lib/server/google-calendar-db", () => ({
  insertAgendaEvent: (...args: unknown[]) => insertAgendaEventMock(...args),
  updateAgendaEvent: (...args: unknown[]) => updateAgendaEventMock(...args),
  cancelAgendaEvent: (...args: unknown[]) => cancelAgendaEventMock(...args),
  getAgendaEventById: (...args: unknown[]) => getAgendaEventByIdMock(...args),
  getGoogleCalendarToken: (...args: unknown[]) => getGoogleCalendarTokenMock(...args),
}));
vi.mock("@/lib/server/google-calendar", () => ({
  createGoogleCalendarEvent: (...args: unknown[]) => createGoogleCalendarEventMock(...args),
  cancelGoogleCalendarEvent: (...args: unknown[]) => cancelGoogleCalendarEventMock(...args),
}));
vi.mock("@/lib/server/agenda-realtime", () => ({
  broadcastAgendaChange: (...args: unknown[]) => broadcastAgendaChangeMock(...args),
}));

function makeSbNoExisting() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                gte: () => ({
                  ilike: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () =>
                          table === "leads"
                            ? { data: null, error: null }
                            : { data: null, error: null },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown;
}

function makeSbWithExisting(existing: Record<string, unknown>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                gte: () => ({
                  ilike: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () =>
                          table === "leads"
                            ? { data: null, error: null }
                            : { data: existing, error: null },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown;
}

function makeStructuredSb(existing: Record<string, unknown> | null = null) {
  return {
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          neq: () => chain,
          gte: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () =>
            table === "leads"
              ? { data: { name: "Maria" }, error: null }
              : { data: existing, error: null },
        };
        return chain;
      },
    }),
  } as never;
}

/**
 * Mock que diferencia a query de conflito (usa .lt/.gt) da busca do próximo evento
 * ativo do contato (usa .gte). Registra os args de .neq para asserts do excludeEventId.
 */
function makeConflictSb(options: {
  existing?: Record<string, unknown> | null;
  conflictRow?: Record<string, unknown> | null;
} = {}) {
  const neqCalls: Array<[string, unknown]> = [];
  const sb = {
    from: (table: string) => ({
      select: () => {
        let usedOverlap = false;
        const chain = {
          eq: () => chain,
          neq: (col: string, val: unknown) => {
            neqCalls.push([col, val]);
            return chain;
          },
          gte: () => chain,
          lt: () => {
            usedOverlap = true;
            return chain;
          },
          gt: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (table === "leads") return { data: { name: "Maria" }, error: null };
            if (usedOverlap) return { data: options.conflictRow ?? null, error: null };
            return { data: options.existing ?? null, error: null };
          },
        };
        return chain;
      },
    }),
  } as never;
  return { sb, neqCalls };
}

describe("agent-cta-scheduler", () => {
  it("aplica backoff exponencial com teto na sincronização externa", () => {
    expect(agendaSyncRetryMinutes(1)).toBe(1);
    expect(agendaSyncRetryMinutes(4)).toBe(8);
    expect(agendaSyncRetryMinutes(20)).toBe(60);
  });
  beforeEach(() => {
    insertAgendaEventMock.mockReset();
    updateAgendaEventMock.mockReset();
    cancelAgendaEventMock.mockReset();
    getAgendaEventByIdMock.mockReset();
    getGoogleCalendarTokenMock.mockReset();
    createGoogleCalendarEventMock.mockReset();
    cancelGoogleCalendarEventMock.mockReset();
    broadcastAgendaChangeMock.mockReset();
    getGoogleCalendarTokenMock.mockResolvedValue(null);
  });

  it("detects scheduling CTA value", () => {
    expect(isSchedulingCta("Agendar no Google Agenda")).toBe(true);
    expect(isSchedulingCta("Transferir para humano")).toBe(false);
  });

  it("parses and strips a structured scheduling directive", () => {
    const text = "Combinado! [[ AGENDAR: data=02/06/2026, hora=14:30, local=Sala 2 ]]";
    expect(parseAgendaDirectives(text)).toEqual({
      directives: [{ type: "schedule", date: "02/06/2026", time: "14:30", location: "Sala 2" }],
      invalid: false,
    });
    expect(stripAgendaDirectives(text)).toBe("Combinado!");
  });

  it("prepares a directive without persisting it before delivery", () => {
    expect(
      prepareAgendaDirectiveInReply({
        text: "Combinado! [[AGENDAR: data=02/06/2099, hora=14:30]]",
        enabled: true,
      }),
    ).toEqual({
      text: "Combinado!",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
      action: "pending",
    });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("strips but blocks agenda directives when automation is disabled", () => {
    expect(
      prepareAgendaDirectiveInReply({
        text: "Combinado! [[AGENDAR: data=02/06/2099, hora=14:30]]",
        enabled: false,
      }),
    ).toEqual({ text: "Combinado!", directive: null, action: "blocked" });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("parses cancellation only with a valid UUID", () => {
    expect(
      parseAgendaDirectives("[[CANCELAR_AGENDA: id=123e4567-e89b-42d3-a456-426614174000]]"),
    ).toEqual({
      directives: [{ type: "cancel", eventId: "123e4567-e89b-42d3-a456-426614174000" }],
      invalid: false,
    });
    expect(parseAgendaDirectives("[[CANCELAR_AGENDA: id=invalido]]").invalid).toBe(true);
  });

  it("parses [[CANCELAR_AGENDA]] without params as auto-cancel", () => {
    expect(parseAgendaDirectives("Cancelado! [[CANCELAR_AGENDA]]")).toEqual({
      directives: [{ type: "cancel", eventId: null }],
      invalid: false,
    });
    expect(stripAgendaDirectives("Cancelado! [[CANCELAR_AGENDA]]")).toBe("Cancelado!");
  });

  it("rejects incomplete, invalid and conflicting directives", () => {
    expect(parseAgendaDirectives("[[AGENDAR: data=31/02/2026, hora=14:30]]").invalid).toBe(true);
    expect(parseAgendaDirectives("[[AGENDAR: data=02/06/2026]]").invalid).toBe(true);
    expect(
      parseAgendaDirectives(
        "[[AGENDAR: data=02/06/2026, hora=14:30]] [[CANCELAR_AGENDA: id=123e4567-e89b-42d3-a456-426614174000]]",
      ).invalid,
    ).toBe(true);
  });

  it("detects confirmation intent with scheduling context", () => {
    expect(detectSchedulingConfirmation("Perfeito, pode agendar para amanhã às 14:30")).toBe(true);
    expect(detectSchedulingConfirmation("Quero saber mais sobre o serviço")).toBe(false);
  });

  it("webhook scenario: lead says sim after agent proposed a schedule", () => {
    const priorProposal = "Posso agendar seu horário para amanhã às 14h na unidade central?";
    const modelReply = "Ótimo, confirmado!";
    expect(
      detectSchedulingConfirmation(
        "sim",
        assistantTextForSchedulingConfirmation(modelReply, priorProposal),
      ),
    ).toBe(true);
  });

  it("detects reschedule intent", () => {
    expect(detectRescheduleIntent("quero remarcar para outro horário")).toBe(true);
    expect(
      detectRescheduleIntent("sim", "Tudo bem, deseja remarcar para qual horário?"),
    ).toBe(true);
  });

  it("extracts location from assistant text", () => {
    expect(
      extractLocationFromText("Horário amanhã às 14h na unidade central"),
    ).toContain("unidade central");
  });

  it("formats existing appointment block", () => {
    const block = formatExistingAppointmentSchedulingBlock(
      {
        id: "e1",
        title: "Agendamento via WhatsApp - Maria",
        start_at: "2026-05-30T17:00:00.000Z",
        end_at: "2026-05-30T18:00:00.000Z",
        status: "pending",
        attendee_name: "Maria",
        location: "Stand A",
        description: null,
      },
      "America/Sao_Paulo",
    );
    expect(block).toContain("CONTEXTO DE AGENDAMENTO");
    expect(block).toContain("remarcar");
  });

  it("creates agenda event when no active duplicate exists", async () => {
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-1" });
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbNoExisting() as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "Confirmado, pode agendar para amanhã às 10:00",
      assistantMessage: "Perfeito, visita amanhã às 10:00 no escritório central.",
      timezone: "America/Sao_Paulo",
      leadId: "lead-1",
      agentId: "agent-1",
    });

    expect(result).toEqual({ created: true, eventId: "evt-1" });
    expect(insertAgendaEventMock).toHaveBeenCalledTimes(1);
    const payload = insertAgendaEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.tenant_id).toBe("t1");
    expect(payload.lead_id).toBe("lead-1");
    expect(payload.agent_id).toBe("agent-1");
    expect(payload.attendee_name).toBe("Maria");
    expect(payload.created_by).toBe("agent");
  });

  it("returns active_exists when duplicate appointment", async () => {
    const existing = {
      id: "evt-old",
      title: "Agendamento via WhatsApp - Maria",
      start_at: "2026-05-30T17:00:00.000Z",
      end_at: "2026-05-30T18:00:00.000Z",
      status: "pending",
      attendee_name: "Maria",
      location: null,
      description: null,
    };
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbWithExisting(existing) as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "sim",
      assistantMessage: "amanhã às 14h",
      timezone: "America/Sao_Paulo",
    });

    expect(result.created).toBe(false);
    if (!result.created) {
      expect(result.reason).toBe("active_exists");
      expect(result.existing.id).toBe("evt-old");
    }
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("cancels and creates on reschedule", async () => {
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-new" });
    updateAgendaEventMock.mockResolvedValueOnce(undefined);
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbNoExisting() as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "remarcar para amanhã às 15h",
      assistantMessage: "Combinado, amanhã às 15h.",
      timezone: "America/Sao_Paulo",
      rescheduleOfEventId: "evt-old",
    });

    expect(updateAgendaEventMock).toHaveBeenCalledWith("t1", "evt-old", { status: "cancelled" });
    expect(result).toEqual({ created: true, eventId: "evt-new" });
  });

  it("returns unparsed_datetime when no time in messages", async () => {
    const result = await createAgendaEventForSchedulingCta({
      sb: makeSbNoExisting() as never,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      contactName: "Maria",
      userMessage: "sim",
      assistantMessage: "ótimo!",
      timezone: "America/Sao_Paulo",
    });

    expect(result).toEqual({ created: false, reason: "unparsed_datetime" });
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("creates a structured agenda event locally when Google is disconnected", async () => {
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-new" });
    const result = await executeAgendaDirective({
      sb: makeStructuredSb(),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      leadId: "lead-1",
      agentId: "agent-1",
      timezone: "America/Sao_Paulo",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: "Sala 2" },
    });

    expect(result).toEqual({ action: "scheduled", eventId: "evt-new" });
    expect(insertAgendaEventMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: "t1",
      attendee_phone: "5562999999999",
      location: "Sala 2",
      google_event_id: null,
    }));
  });

  it("creates the remote Google event when the tenant calendar is connected", async () => {
    getGoogleCalendarTokenMock.mockResolvedValueOnce({ tenant_id: "t1" });
    createGoogleCalendarEventMock.mockResolvedValueOnce({ id: "google-1" });
    insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-new" });

    await executeAgendaDirective({
      sb: makeStructuredSb(),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
    });

    expect(createGoogleCalendarEventMock).toHaveBeenCalledTimes(1);
    expect(insertAgendaEventMock).toHaveBeenCalledWith(expect.objectContaining({ google_event_id: "google-1" }));
  });

  it("does not cancel an event belonging to another phone", async () => {
    getAgendaEventByIdMock.mockResolvedValueOnce({
      id: "123e4567-e89b-42d3-a456-426614174000",
      attendee_phone: "5562888888888",
      google_event_id: null,
    });

    await expect(
      executeAgendaDirective({
        sb: makeStructuredSb(),
        tenantId: "t1",
        remoteJid: "5562999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        directive: { type: "cancel", eventId: "123e4567-e89b-42d3-a456-426614174000" },
      }),
    ).rejects.toThrow("agenda_event_contact_mismatch");
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("auto-cancels next active event when no id provided", async () => {
    const activeEvent = {
      id: "evt-active",
      attendee_phone: "5562999999999",
      google_event_id: null,
      start_at: "2099-06-10T17:00:00.000Z",
    };
    const result = await executeAgendaDirective({
      sb: makeStructuredSb(activeEvent),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      directive: { type: "cancel", eventId: null },
    });
    expect(result).toEqual({ action: "cancelled", eventId: "evt-active" });
    expect(cancelAgendaEventMock).toHaveBeenCalledWith("t1", "evt-active");
  });

  it("throws when auto-cancel finds no active event", async () => {
    await expect(
      executeAgendaDirective({
        sb: makeStructuredSb(null),
        tenantId: "t1",
        remoteJid: "5562999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        directive: { type: "cancel", eventId: null },
      }),
    ).rejects.toThrow("agenda_event_not_found");
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("creates the replacement before cancelling the nearest active event", async () => {
    const existing = {
      id: "evt-old",
      attendee_phone: "5562999999999",
      google_event_id: null,
      start_at: "2099-06-01T13:00:00.000Z",
    };
    insertAgendaEventMock.mockResolvedValueOnce({
      id: "evt-new",
      attendee_phone: "5562999999999",
      google_event_id: null,
    });

    const result = await executeAgendaDirective({
      sb: makeStructuredSb(existing),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
    });

    expect(result).toEqual({ action: "rescheduled", eventId: "evt-new" });
    expect(cancelAgendaEventMock).toHaveBeenCalledWith("t1", "evt-old");
  });

  it("uses the durable RPC for an idempotent agenda operation key", async () => {
    const event = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      tenant_id: "t1",
      google_event_id: null,
      title: "Agendamento via WhatsApp - Maria",
      description: null,
      location: null,
      color: "#f24400",
      start_at: "2099-06-02T17:30:00.000Z",
      end_at: "2099-06-02T18:30:00.000Z",
      all_day: false,
      attendee_name: "Maria",
      attendee_phone: "5562999999999",
      attendee_email: null,
      status: "pending",
      created_by: "agent",
      lead_id: null,
      agent_id: "agent-1",
      created_at: "2099-01-01T00:00:00.000Z",
      updated_at: "2099-01-01T00:00:00.000Z",
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        action: "scheduled",
        event,
        previous_event: null,
        changed: false,
        deduplicated: true,
        operation_status: "local_committed",
      },
      error: null,
    });
    const operationUpdates: unknown[] = [];
    const sb = {
      rpc,
      from: (table: string) => {
        if (table === "agenda_sync_outbox") {
          return {
            update: () => {
              const chain = { eq: vi.fn() };
              chain.eq.mockReturnValue(chain);
              return chain;
            },
          };
        }
        if (table !== "agenda_mutation_operations") {
          throw new Error(`unexpected table ${table}`);
        }
        return {
          update: (patch: unknown) => {
            operationUpdates.push(patch);
            const chain = {
              eq: vi.fn(),
            };
            chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null });
            return chain;
          },
        };
      },
    } as never;

    const result = await executeAgendaDirective({
      sb,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      agentId: "agent-1",
      contactName: "Maria",
      timezone: "America/Sao_Paulo",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
      operationKey: "evolution:t1:message-1",
    });

    expect(result).toEqual({ action: "scheduled", eventId: event.id });
    expect(rpc).toHaveBeenCalledWith("apply_agent_agenda_mutation", expect.objectContaining({
      p_tenant_id: "t1",
      p_operation_key: "evolution:t1:message-1",
      p_action: "schedule",
    }));
    expect(operationUpdates).toHaveLength(1);
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
    expect(cancelAgendaEventMock).not.toHaveBeenCalled();
  });

  it("builds the outside-availability reply from the configured window", () => {
    const disp = { ativo: true, diasSemana: [1, 2, 3], horaInicio: "09:00", horaFim: "18:00" };
    const reply = buildOutsideAvailabilityReply(disp);
    expect(reply).toContain("segunda, terça e quarta");
    expect(reply).toContain("das 09:00 às 18:00");
    expect(reply).not.toMatch(/equipe|humano|atendente/i);
  });

  it("uses the custom outside-availability message when configured (trimmed)", () => {
    const disp = {
      ativo: true,
      diasSemana: [1],
      horaInicio: "09:00",
      horaFim: "18:00",
      mensagemForaJanela: "  Só atendemos com hora marcada dentro do expediente. Me passa outro horário?  ",
    };
    expect(buildOutsideAvailabilityReply(disp)).toBe(
      "Só atendemos com hora marcada dentro do expediente. Me passa outro horário?",
    );
  });

  it("falls back to a generic reply when the window has no days", () => {
    const reply = buildOutsideAvailabilityReply({ ativo: true, diasSemana: [], horaInicio: "09:00", horaFim: "18:00" });
    expect(reply).toContain("fora da nossa janela de agendamento");
    expect(buildOutsideAvailabilityReply(null)).toContain("fora da nossa janela de agendamento");
  });

  it("replies with the dynamic window message when the slot is outside availability", async () => {
    const disp = { ativo: true, diasSemana: [0, 1, 2, 3, 4, 5, 6], horaInicio: "09:00", horaFim: "12:00" };
    const result = await executePreparedAgendaDirective({
      sb: makeStructuredSb(),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      prepared: {
        text: "Confirmado!",
        directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
        action: "pending",
      },
      agendaDisponibilidade: disp,
    });

    expect(result.action).toBe("failed");
    expect(result.text).toBe(buildOutsideAvailabilityReply(disp));
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
  });

  it("replies with the custom message when outside availability and one is configured", async () => {
    const disp = {
      ativo: true,
      diasSemana: [0, 1, 2, 3, 4, 5, 6],
      horaInicio: "09:00",
      horaFim: "12:00",
      mensagemForaJanela: "Nossa janela é pela manhã. Me diga um horário entre 09:00 e 12:00.",
    };
    const result = await executePreparedAgendaDirective({
      sb: makeStructuredSb(),
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      prepared: {
        text: "Confirmado!",
        directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
        action: "pending",
      },
      agendaDisponibilidade: disp,
    });

    expect(result.action).toBe("failed");
    expect(result.text).toBe("Nossa janela é pela manhã. Me diga um horário entre 09:00 e 12:00.");
  });

  it("blocks double-booking when simultaneous appointments are disabled", async () => {
    const { sb } = makeConflictSb({ conflictRow: { id: "evt-busy" } });
    await expect(
      executeAgendaDirective({
        sb,
        tenantId: "t1",
        remoteJid: "5562999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
        agendaDisponibilidade: {
          ativo: false,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "08:00",
          horaFim: "18:00",
          permitirAgendamentosSimultaneos: false,
        },
      }),
    ).rejects.toThrow("agenda_slot_taken");
    expect(insertAgendaEventMock).not.toHaveBeenCalled();
    expect(createGoogleCalendarEventMock).not.toHaveBeenCalled();
  });

  it("replies with the slot-taken message via executePreparedAgendaDirective", async () => {
    const { sb } = makeConflictSb({ conflictRow: { id: "evt-busy" } });
    const result = await executePreparedAgendaDirective({
      sb,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      prepared: {
        text: "Confirmado!",
        directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
        action: "pending",
      },
      agendaDisponibilidade: {
        ativo: false,
        diasSemana: [1, 2, 3, 4, 5],
        horaInicio: "08:00",
        horaFim: "18:00",
        permitirAgendamentosSimultaneos: false,
      },
    });

    expect(result.action).toBe("failed");
    expect(result.text).toBe(AGENDA_SLOT_TAKEN_REPLY);
  });

  it("schedules normally when simultaneous appointments are allowed or unset", async () => {
    for (const permitir of [true, undefined]) {
      insertAgendaEventMock.mockReset();
      insertAgendaEventMock.mockResolvedValueOnce({ id: "evt-new" });
      const { sb } = makeConflictSb({ conflictRow: { id: "evt-busy" } });
      const result = await executeAgendaDirective({
        sb,
        tenantId: "t1",
        remoteJid: "5562999999999@s.whatsapp.net",
        timezone: "America/Sao_Paulo",
        directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
        agendaDisponibilidade: {
          ativo: false,
          diasSemana: [1, 2, 3, 4, 5],
          horaInicio: "08:00",
          horaFim: "18:00",
          permitirAgendamentosSimultaneos: permitir,
        },
      });
      expect(result).toEqual({ action: "scheduled", eventId: "evt-new" });
    }
  });

  it("excludes the contact's own event from the conflict check on reschedule", async () => {
    const existing = {
      id: "evt-old",
      attendee_phone: "5562999999999",
      google_event_id: null,
      start_at: "2099-06-01T13:00:00.000Z",
    };
    const { sb, neqCalls } = makeConflictSb({ existing, conflictRow: null });
    insertAgendaEventMock.mockResolvedValueOnce({
      id: "evt-new",
      attendee_phone: "5562999999999",
      google_event_id: null,
    });

    const result = await executeAgendaDirective({
      sb,
      tenantId: "t1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      directive: { type: "schedule", date: "02/06/2099", time: "14:30", location: null },
      agendaDisponibilidade: {
        ativo: false,
        diasSemana: [1, 2, 3, 4, 5],
        horaInicio: "08:00",
        horaFim: "18:00",
        permitirAgendamentosSimultaneos: false,
      },
    });

    expect(result).toEqual({ action: "rescheduled", eventId: "evt-new" });
    expect(neqCalls).toContainEqual(["id", "evt-old"]);
    expect(cancelAgendaEventMock).toHaveBeenCalledWith("t1", "evt-old");
  });
});
