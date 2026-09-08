/**
 * Canal de tempo real das reuniões.
 *
 * Um canal por tenant, no mesmo padrão de `lib/agenda/realtime.ts`. O payload
 * carrega só identificador e status — nunca título, transcrição ou resumo:
 * quem recebe o evento busca o dado pela rota autenticada, que aplica o escopo.
 * Empurrar conteúdo pelo canal contornaria a permissão.
 */
export function meetingsRealtimeChannel(tenantId: string) {
  return `meetings:${tenantId}`;
}

export const MEETING_REALTIME_EVENT = "meeting_changed";

export type MeetingRealtimePayload = {
  meetingId: string;
  status: string;
};
