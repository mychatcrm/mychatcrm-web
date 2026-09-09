import type { LabStepV1, LabVerdict } from "./contracts";

/** What the laboratory found in the database after a real conversation. */
export type LabObservedEffects = {
  leadCreated: boolean;
  agendaCreated: number;
  agendaCancelled: number;
  followUpScheduled: number;
  reminderScheduled: number;
  outboundConfirmed: number;
  outboundUnconfirmed: number;
};

export const LAB_EMPTY_EFFECTS: LabObservedEffects = {
  leadCreated: false, agendaCreated: 0, agendaCancelled: 0, followUpScheduled: 0,
  reminderScheduled: 0, outboundConfirmed: 0, outboundUnconfirmed: 0,
};

/**
 * Settles an effect expectation against the database, never against the reply text.
 *
 * The distinction that matters: a timer the run was too short to reach is
 * "not_executed", not "failed". A reminder that fires in a day cannot be proved by
 * a twenty-minute test, and reporting it as a failure would train the reader to
 * ignore failures.
 */
export function labEffectVerdict(
  expected: LabStepV1["expected"]["type"],
  observed: LabObservedEffects,
  window: { elapsedMs: number; requiredMs: number | null },
): { verdict: LabVerdict; code: string; description: string } {
  const tooShort = window.requiredMs !== null && window.elapsedMs < window.requiredMs;

  switch (expected) {
    case "agenda_created":
      return observed.agendaCreated > 0
        ? { verdict: "passed", code: "agenda_confirmed", description: `Compromisso confirmado no banco (${observed.agendaCreated}).` }
        : { verdict: "failed", code: "agenda_not_created", description: "Nenhum compromisso foi criado, independentemente do que a resposta dizia." };
    case "agenda_cancelled":
      return observed.agendaCancelled > 0
        ? { verdict: "passed", code: "agenda_cancellation_confirmed", description: `Cancelamento confirmado no banco (${observed.agendaCancelled}).` }
        : { verdict: "failed", code: "agenda_not_cancelled", description: "Nenhum cancelamento foi registrado." };
    case "follow_up":
      if (observed.followUpScheduled > 0) {
        return { verdict: "passed", code: "follow_up_scheduled", description: `Follow-up agendado (${observed.followUpScheduled}).` };
      }
      return tooShort
        ? { verdict: "not_executed", code: "follow_up_window_too_short", description: "A execução terminou antes do intervalo do follow-up. Não é falha: não deu tempo." }
        : { verdict: "failed", code: "follow_up_not_scheduled", description: "Nenhum follow-up foi agendado." };
    case "reminder":
      if (observed.reminderScheduled > 0) {
        return { verdict: "passed", code: "reminder_scheduled", description: `Lembrete agendado (${observed.reminderScheduled}).` };
      }
      return tooShort
        ? { verdict: "not_executed", code: "reminder_window_too_short", description: "O lembrete acontece depois do fim desta execução. Não é falha: não deu tempo." }
        : { verdict: "failed", code: "reminder_not_scheduled", description: "Nenhum lembrete foi agendado." };
    case "media_understood":
      // Receiving a file is not the same as reading it. Only a human or the
      // semantic evaluator can settle this, and both are advisory.
      return { verdict: "inconclusive", code: "media_understanding_needs_review", description: "Receber o arquivo não prova que o agente o interpretou. Revise o conteúdo da resposta." };
    default:
      return { verdict: "inconclusive", code: "expectation_not_effect_based", description: "Esta expectativa não é verificada por efeito." };
  }
}

/** Delivery is only proven by the provider, never by the outbox row existing. */
export function labDeliveryVerdict(observed: LabObservedEffects): { verdict: LabVerdict; code: string; description: string } {
  if (observed.outboundUnconfirmed > 0 && observed.outboundConfirmed === 0) {
    return { verdict: "inconclusive", code: "delivery_unconfirmed", description: `${observed.outboundUnconfirmed} envio(s) do agente sem confirmação do provedor.` };
  }
  if (observed.outboundConfirmed > 0) {
    return { verdict: "passed", code: "delivery_confirmed", description: `${observed.outboundConfirmed} envio(s) confirmados pelo provedor.` };
  }
  return { verdict: "not_executed", code: "no_outbound_recorded", description: "O agente não registrou envio nesta jornada." };
}
