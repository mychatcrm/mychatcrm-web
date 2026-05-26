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
  timezone: "UTC",
  retomadaHumanoTempoValor: null,   // null = sem restrição (retrocompatível)
  retomadaHumanoTempoUnidade: "horas" as const,
};

function bool(src: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (src[key] === true) return true;
  if (src[key] === false) return false;
  return fallback;
}

export function followUpInteligenteFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): AgentFollowUpInteligente {
  const raw = metadata?.followUpInteligente;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FOLLOW_UP_INTELIGENTE };
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
    timezone: parseTimezone(src.timezone),
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
  };
}

const VALID_IANA_RE = /^[A-Za-z]+(?:\/[A-Za-z_]+){0,2}$/;

function parseTimezone(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "UTC";
  const tz = raw.trim();
  if (!VALID_IANA_RE.test(tz)) return "UTC";
  try {
    // Validate that the timezone is supported by the runtime
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}
