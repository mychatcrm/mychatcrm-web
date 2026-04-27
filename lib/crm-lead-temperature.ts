import type { ClientLead } from "@/lib/dashboard-data";
import { funnelColumnTitle, type CrmFunnel } from "@/lib/crm-funnels";
import type { CrmTimelineItem } from "@/lib/crm-lead-extras";

export type LeadTemperatureLevel = 0 | 1 | 2 | 3;

export type LeadTemperatureResult = {
  /** 0–100 */
  score: number;
  level: LeadTemperatureLevel;
  label: string;
  /** Resumo curto para tooltip / acessibilidade. */
  hint: string;
};

const LABELS = ["Frio", "Morno", "Quente", "Fervendo"] as const;

function stageProgressScore(lead: ClientLead, funnel: CrmFunnel | undefined): number {
  if (!funnel?.columns.length) {
    const fallback: Record<string, number> = {
      novo: 14,
      contato: 30,
      proposta: 48,
      negociacao: 62,
      fechado: 88,
      perdido: 18,
    };
    return fallback[lead.status] ?? 22;
  }
  const idx = funnel.columns.findIndex((c) => c.id === lead.status);
  if (idx < 0) return 22;
  const n = funnel.columns.length;
  return Math.round(((idx + 1) / n) * 52 + 8);
}

function tipoTimelinePontos(tipo: CrmTimelineItem["tipo"]): number {
  switch (tipo) {
    case "entrada":
      return 6;
    case "whatsapp":
      return 14;
    case "email":
      return 9;
    case "followup":
      return 22;
    case "sistema":
      return 12;
    case "pipeline":
      return 7;
    case "nota":
      return 5;
    default:
      return 0;
  }
}

/**
 * Estima a «temperatura» comercial do lead a partir do histórico de interações,
 * etapa no funil, valor, tags e recência do último contacto (heurística demo).
 */
export function computeLeadTemperature(
  lead: ClientLead,
  timeline: readonly CrmTimelineItem[],
  funnel: CrmFunnel | undefined,
): LeadTemperatureResult {
  const reasons: string[] = [];
  let score = stageProgressScore(lead, funnel);
  reasons.push(`Etapa «${funnelColumnTitle(funnel, lead.status)}»`);

  const n = timeline.length;
  timeline.forEach((item, i) => {
    let pts = tipoTimelinePontos(item.tipo);
    if (n > 0 && i >= Math.max(0, n - 3)) pts *= 1.28;
    score += pts;
  });
  if (timeline.length >= 4) {
    reasons.push(`${timeline.length} eventos no histórico`);
  }
  if (timeline.some((t) => t.tipo === "followup")) reasons.push("Follow-ups registados");
  if (timeline.some((t) => t.tipo === "whatsapp")) reasons.push("Actividade WhatsApp");
  if (timeline.some((t) => t.tipo === "sistema")) reasons.push("Sinais de intenção (automação)");
  if (timeline.filter((t) => t.tipo === "pipeline").length >= 2) reasons.push("Várias movimentações no funil");

  const valorBoost = Math.min(16, Math.round(lead.valor / 750));
  score += valorBoost;
  if (valorBoost >= 8) reasons.push("Valor elevado");

  const tagHot = lead.tags.some((t) => /quente|hot|premium|urgente|demo/i.test(t));
  if (tagHot) {
    score += 12;
    reasons.push("Tags de interesse");
  }

  const uc = lead.ultimoContato.toLowerCase();
  if (uc.includes("hoje") || uc.includes("agora")) {
    score += 10;
    reasons.push("Último contacto recente");
  } else if (uc.includes("ontem")) {
    score += 5;
  } else if (uc.includes("atrás") || uc.includes("dias") || uc.includes("semana")) {
    score -= 6;
    reasons.push("Último contacto há mais tempo");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: LeadTemperatureLevel = 0;
  if (score >= 76) level = 3;
  else if (score >= 54) level = 2;
  else if (score >= 32) level = 1;

  const hint = reasons.slice(0, 4).join(" · ");

  return {
    score,
    level,
    label: LABELS[level],
    hint: hint.length > 160 ? `${hint.slice(0, 157)}…` : hint,
  };
}
