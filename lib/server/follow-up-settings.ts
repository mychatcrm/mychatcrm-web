import { normalizeIanaTimezone } from "@/lib/agents/agent-datetime";
import type { AgentFollowUpInteligente } from "@/lib/types";

export const DEFAULT_FOLLOW_UP_INTELIGENTE: AgentFollowUpInteligente = {
  ativo: false,
  tentativasContato: 3,
  intervaloVerificacaoMinutos: 60,
  modo: "moderado",
  cooldownAtivo: true,
  cooldownMinutos: 24 * 60,
  usarHorarioComercial: true,
  horaInicio: 8,
  minutoInicio: 0,
  horaFim: 18,
  minutoFim: 0,
  diasAtivos: [1, 2, 3, 4, 5],
  respeitarHumanoAtivo: true,
  retomadaApenasSeHumanoAbandonou: false,
  bloquearSeLeadRespondeu: true,
  bloquearTarefaFutura: true,
  bloquearStatusPerdido: true,
  permitirSlaVencido: true,
  slaHorasResposta: 4,
  desativarAposEncerrar: true,
  usarDadosFormularioMeta: true,
  usarHistoricoCrm: true,
  usarHistoricoWhatsapp: true,
  // Deliberately absent: a business-hours window requires an explicit IANA
  // timezone chosen by the operator. The runtime never guesses a country.
  timezone: undefined,
  retomadaHumanoTempoValor: null,   // null = sem restrição (retrocompatível)
  retomadaHumanoTempoUnidade: "horas" as const,
  // Movimentação do card no CRM ao longo do ciclo de follow-up. Tudo desligado
  // e sem destino: nenhum agente muda de comportamento até o dono da conta
  // ligar e escolher o funil e a coluna.
  crmMoveOnFollowUpEnabled: false,
  crmFollowUpFunnelId: null,
  crmFollowUpColumnId: null,
  crmMoveOnExhaustedEnabled: false,
  crmExhaustedFunnelId: null,
  crmExhaustedColumnId: null,
  crmMoveOnReturnAfterExhaustedEnabled: false,
  crmReturnFunnelId: null,
  crmReturnColumnId: null,
};

function bool(src: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (src[key] === true) return true;
  if (src[key] === false) return false;
  return fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Lê um destino de CRM (ligado + funil + coluna) da config salva.
 *
 * Config pela metade — ligado mas sem funil ou sem coluna — vira desligado.
 * Nunca preenchemos um funil ou uma coluna por conta própria: quem escolhe o
 * destino é o dono do agente, e um palpite nosso moveria cards para o lugar
 * errado no CRM do cliente.
 */
function crmDestino(
  src: Record<string, unknown>,
  enabledKey: string,
  funnelKey: string,
  columnKey: string,
): { enabled: boolean; funnelId: string | null; columnId: string | null } {
  const funnelId = text(src[funnelKey]);
  const columnId = text(src[columnKey]);
  const enabled = src[enabledKey] === true && Boolean(funnelId) && Boolean(columnId);
  return enabled ? { enabled, funnelId, columnId } : { enabled: false, funnelId: null, columnId: null };
}

export function followUpInteligenteFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): AgentFollowUpInteligente {
  const raw = metadata?.followUpInteligente;
  if (!raw || typeof raw !== "object") {
    const timezone = normalizeIanaTimezone(metadata?.timezone) ?? undefined;
    return { ...DEFAULT_FOLLOW_UP_INTELIGENTE, timezone };
  }
  const src = raw as Record<string, unknown>;
  const defaults = DEFAULT_FOLLOW_UP_INTELIGENTE;

  const tentativas = Number(src.tentativasContato);
  const intervalo = Number(src.intervaloVerificacaoMinutos);
  const cooldown = Number(src.cooldownMinutos);
  const slaRaw = src.slaHorasResposta;
  const sla =
    slaRaw === null || slaRaw === undefined
      ? null
      : Number(slaRaw);
  const horaInicio = Number(src.horaInicio);
  const horaFim = Number(src.horaFim);
  const minutoInicio = Number(src.minutoInicio ?? 0);
  const minutoFim = Number(src.minutoFim ?? 0);

  const validModos = new Set<string>(["agressivo", "moderado", "suave"]);
  const modo =
    typeof src.modo === "string" && validModos.has(src.modo)
      ? (src.modo as "agressivo" | "moderado" | "suave")
      : defaults.modo;

  const diasAtivos = Array.isArray(src.diasAtivos)
    ? (src.diasAtivos as unknown[])
        .map(Number)
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : defaults.diasAtivos;

  const permitirSla = bool(src, "permitirSlaVencido", defaults.permitirSlaVencido);

  const followUpDestino = crmDestino(
    src,
    "crmMoveOnFollowUpEnabled",
    "crmFollowUpFunnelId",
    "crmFollowUpColumnId",
  );
  const esgotadoDestino = crmDestino(
    src,
    "crmMoveOnExhaustedEnabled",
    "crmExhaustedFunnelId",
    "crmExhaustedColumnId",
  );
  const retornoDestino = crmDestino(
    src,
    "crmMoveOnReturnAfterExhaustedEnabled",
    "crmReturnFunnelId",
    "crmReturnColumnId",
  );

  return {
    ativo: src.ativo === true,
    tentativasContato:
      Number.isFinite(tentativas) && tentativas >= 1 ? Math.round(tentativas) : defaults.tentativasContato,
    intervaloVerificacaoMinutos:
      Number.isFinite(intervalo) && intervalo >= 1
        ? Math.round(intervalo)
        : defaults.intervaloVerificacaoMinutos,
    modo,
    cooldownAtivo: bool(src, "cooldownAtivo", defaults.cooldownAtivo),
    cooldownMinutos:
      Number.isFinite(cooldown) && cooldown >= 1 ? Math.round(cooldown) : defaults.cooldownMinutos,
    usarHorarioComercial: bool(src, "usarHorarioComercial", defaults.usarHorarioComercial),
    horaInicio:
      Number.isFinite(horaInicio) && horaInicio >= 0 && horaInicio <= 23
        ? Math.round(horaInicio)
        : defaults.horaInicio,
    minutoInicio:
      Number.isFinite(minutoInicio) && minutoInicio >= 0 && minutoInicio <= 59
        ? Math.round(minutoInicio)
        : 0,
    horaFim:
      Number.isFinite(horaFim) && horaFim >= 0 && horaFim <= 23
        ? Math.round(horaFim)
        : defaults.horaFim,
    minutoFim:
      Number.isFinite(minutoFim) && minutoFim >= 0 && minutoFim <= 59
        ? Math.round(minutoFim)
        : 0,
    diasAtivos,
    respeitarHumanoAtivo: bool(src, "respeitarHumanoAtivo", defaults.respeitarHumanoAtivo),
    retomadaApenasSeHumanoAbandonou: bool(
      src,
      "retomadaApenasSeHumanoAbandonou",
      defaults.retomadaApenasSeHumanoAbandonou,
    ),
    bloquearSeLeadRespondeu: bool(src, "bloquearSeLeadRespondeu", defaults.bloquearSeLeadRespondeu),
    bloquearTarefaFutura: bool(src, "bloquearTarefaFutura", defaults.bloquearTarefaFutura),
    bloquearStatusPerdido: bool(src, "bloquearStatusPerdido", defaults.bloquearStatusPerdido),
    permitirSlaVencido: permitirSla,
    slaHorasResposta: permitirSla
      ? sla !== null && Number.isFinite(sla) && sla >= 1
        ? Math.round(sla)
        : defaults.slaHorasResposta
      : null,
    desativarAposEncerrar: bool(src, "desativarAposEncerrar", defaults.desativarAposEncerrar),
    usarDadosFormularioMeta: bool(src, "usarDadosFormularioMeta", defaults.usarDadosFormularioMeta),
    usarHistoricoCrm: bool(src, "usarHistoricoCrm", defaults.usarHistoricoCrm),
    usarHistoricoWhatsapp: bool(src, "usarHistoricoWhatsapp", defaults.usarHistoricoWhatsapp),
    timezone:
      typeof metadata?.timezone === "string" && metadata.timezone.trim()
        ? normalizeIanaTimezone(metadata.timezone) ?? undefined
        : normalizeIanaTimezone(src.timezone) ?? undefined,
    // null = sem restrição de tempo para abandono humano (retrocompatível com configs antigas).
    retomadaHumanoTempoValor:
      typeof src.retomadaHumanoTempoValor === "number" && Number.isFinite(src.retomadaHumanoTempoValor)
        ? Math.max(1, Math.round(src.retomadaHumanoTempoValor))
        : null,
    retomadaHumanoTempoUnidade: (["minutos", "horas", "dias"] as const).includes(
      src.retomadaHumanoTempoUnidade as "minutos" | "horas" | "dias",
    )
      ? (src.retomadaHumanoTempoUnidade as "minutos" | "horas" | "dias")
      : "horas",
    // Destinos de CRM: um destino só existe quando ligado E com funil e coluna
    // preenchidos. Config pela metade equivale a desligado — nunca escolhemos
    // um funil ou uma coluna no lugar do dono da conta.
    crmMoveOnFollowUpEnabled: followUpDestino.enabled,
    crmFollowUpFunnelId: followUpDestino.funnelId,
    crmFollowUpColumnId: followUpDestino.columnId,
    crmMoveOnExhaustedEnabled: esgotadoDestino.enabled,
    crmExhaustedFunnelId: esgotadoDestino.funnelId,
    crmExhaustedColumnId: esgotadoDestino.columnId,
    crmMoveOnReturnAfterExhaustedEnabled: retornoDestino.enabled,
    crmReturnFunnelId: retornoDestino.funnelId,
    crmReturnColumnId: retornoDestino.columnId,
  };
}
