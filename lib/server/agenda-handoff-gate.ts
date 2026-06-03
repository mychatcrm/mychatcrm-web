import "server-only";

/** Lead ainda em fluxo de agenda (criar/remarcar/cancelar) sem ação concluída neste turno. */
const PENDING_AGENDA_INBOUND_RE =
  /\b(cancelar|cancela|desmarcar|desmarca|remarcar|reagendar|agendar|marcar|agendamento|consulta|visita|hor[aá]rio)\b/i;

export function shouldDeferHandoffForPendingAgenda(params: {
  agendaAutomationEnabled: boolean;
  agendaActionCompleted?: boolean;
  inboundText: string;
}): boolean {
  if (!params.agendaAutomationEnabled) return false;
  if (params.agendaActionCompleted) return false;
  const text = params.inboundText.trim();
  if (!text) return false;
  return PENDING_AGENDA_INBOUND_RE.test(text);
}
