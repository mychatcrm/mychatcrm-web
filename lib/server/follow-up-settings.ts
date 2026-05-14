import type { AgentFollowUpInteligente } from "@/lib/types";

export const DEFAULT_FOLLOW_UP_INTELIGENTE: AgentFollowUpInteligente = {
  ativo: false,
  tentativasContato: 3,
  intervaloVerificacaoMinutos: 60,
};

export function followUpInteligenteFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): AgentFollowUpInteligente {
  const raw = metadata?.followUpInteligente;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FOLLOW_UP_INTELIGENTE };
  const src = raw as Record<string, unknown>;
  const tentativas = Number(src.tentativasContato);
  const intervalo = Number(src.intervaloVerificacaoMinutos);
  return {
    ativo: src.ativo === true,
    tentativasContato: Number.isFinite(tentativas) && tentativas >= 1 ? Math.round(tentativas) : 3,
    intervaloVerificacaoMinutos:
      Number.isFinite(intervalo) && intervalo >= 1 ? Math.round(intervalo) : 60,
  };
}
