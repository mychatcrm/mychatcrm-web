import type { LabStepV1, LabVerdict } from "./contracts";

/**
 * Reads one simulated turn against the step's expectation.
 *
 * A simulation proves what the agent decided, never what the system did: it does
 * not touch the agenda, the CRM or WhatsApp. So an effect expectation can only ever
 * come back inconclusive here, with the decision attached as evidence. Calling it
 * approved would be the exact false pass the plan sets out to prevent.
 */
export function labSimulationVerdict(
  expected: LabStepV1["expected"]["type"],
  decision: { reply: string; authorization: { allowed: boolean }; agendaBlocked: boolean },
): { verdict: LabVerdict; code: string; description: string } {
  const replied = Boolean(decision.reply?.trim());
  if (expected === "silence") {
    return !replied || !decision.authorization.allowed
      ? { verdict: "expected_block", code: "silence_confirmed", description: "O agente não produziu resposta, como esperado." }
      : { verdict: "failed", code: "silence_expected_but_agent_replied", description: "Era esperado silêncio, mas o agente decidiu responder." };
  }
  if (!replied) {
    return { verdict: "failed", code: "no_reply_decided", description: "O agente não produziu resposta nesta simulação." };
  }
  if (expected === "reply") {
    return { verdict: "passed", code: "reply_decided", description: "O agente decidiu responder. A entrega real não é exercitada em simulação." };
  }
  return {
    verdict: "inconclusive", code: "simulation_decides_but_does_not_execute",
    description: "A simulação mostra a decisão do agente, não o efeito. Confirme em uma execução real antes de aprovar.",
  };
}

/** Effects the decision intended, recorded as intent — never as a confirmed change. */
export function labSimulatedEffects(decision: {
  agenda: unknown; agendaBlocked: boolean; handoff: { triggered: boolean; reason: string | null };
  followUp: { enabled: boolean; wouldCreate: boolean; intervalMinutes: number | null };
  leadOutcome: unknown; externalApiLookups: unknown[]; media: { filenames: string[] };
}): { effect_type: string; details: Record<string, unknown> }[] {
  const effects: { effect_type: string; details: Record<string, unknown> }[] = [];
  if (decision.agenda) effects.push({ effect_type: "agenda_intent", details: { plan: decision.agenda, blocked: decision.agendaBlocked } });
  if (decision.agendaBlocked) effects.push({ effect_type: "agenda_blocked", details: {} });
  if (decision.handoff.triggered) effects.push({ effect_type: "handoff_intent", details: { reason: decision.handoff.reason } });
  if (decision.followUp.wouldCreate) effects.push({ effect_type: "follow_up_intent", details: { intervalMinutes: decision.followUp.intervalMinutes } });
  if (decision.leadOutcome) effects.push({ effect_type: "lead_outcome_intent", details: { outcome: decision.leadOutcome } });
  if (decision.externalApiLookups.length) effects.push({ effect_type: "external_api_intent", details: { count: decision.externalApiLookups.length } });
  if (decision.media.filenames.length) effects.push({ effect_type: "media_intent", details: { filenames: decision.media.filenames } });
  return effects;
}
