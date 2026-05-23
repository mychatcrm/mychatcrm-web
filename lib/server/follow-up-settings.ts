import type { AgentFollowUpInteligente } from "@/lib/types";

export const DEFAULT_FOLLOW_UP_INTELIGENTE: AgentFollowUpInteligente = {
  ativo: false,
  tentativasContato: 3,
  intervaloVerificacaoMinutos: 60,
  modo: "moderado",
  cooldownMinutos: 60,
  slaHorasResposta: null,
  horaInicio: 8,
  horaFim: 18,
  diasAtivos: [1, 2, 3, 4, 5],
  retomadaApenasSeHumanoAbandonou: false,
};

export function followUpInteligenteFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): AgentFollowUpInteligente {
  const raw = metadata?.followUpInteligente;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FOLLOW_UP_INTELIGENTE };
  const src = raw as Record<string, unknown>;

  const tentativas = Number(src.tentativasContato);
  const intervalo = Number(src.intervaloVerificacaoMinutos);
  const cooldown = Number(src.cooldownMinutos);
  const sla = src.slaHorasResposta != null ? Number(src.slaHorasResposta) : null;
  const horaInicio = Number(src.horaInicio);
  const horaFim = Number(src.horaFim);

  const validModos = new Set<string>(["agressivo", "moderado", "suave"]);
  const modo =
    typeof src.modo === "string" && validModos.has(src.modo)
      ? (src.modo as "agressivo" | "moderado" | "suave")
      : "moderado";

  const diasAtivos = Array.isArray(src.diasAtivos)
    ? (src.diasAtivos as unknown[])
        .map(Number)
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [1, 2, 3, 4, 5];

  return {
    ativo: src.ativo === true,
    tentativasContato:
      Number.isFinite(tentativas) && tentativas >= 1 ? Math.round(tentativas) : 3,
    intervaloVerificacaoMinutos:
      Number.isFinite(intervalo) && intervalo >= 1 ? Math.round(intervalo) : 60,
    modo,
    cooldownMinutos:
      Number.isFinite(cooldown) && cooldown >= 1 ? Math.round(cooldown) : 60,
    slaHorasResposta:
      sla !== null && Number.isFinite(sla) && sla >= 1 ? Math.round(sla) : null,
    horaInicio:
      Number.isFinite(horaInicio) && horaInicio >= 0 && horaInicio <= 23
        ? Math.round(horaInicio)
        : 8,
    horaFim:
      Number.isFinite(horaFim) && horaFim >= 0 && horaFim <= 23
        ? Math.round(horaFim)
        : 18,
    diasAtivos,
    retomadaApenasSeHumanoAbandonou: src.retomadaApenasSeHumanoAbandonou === true,
  };
}
