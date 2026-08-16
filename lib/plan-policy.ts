/**
 * Política de planos — fonte única de limites numéricos (billing, API, UI).
 * Textos de vitrine em `lib/plans.ts` (SALES_PLANS) devem alinhar-se a estes valores.
 */

import { PLAN_CHECKOUT_SLUGS } from "@/lib/plans";

export const PLAN_POLICY_VERSION = 2 as const;

/** Slugs canónicos de assinatura (painel + cookies + billing). */
export type NormalizedPlan = "solo" | "equipa" | "escala" | "enterprise";

export type PlanLimits = {
  maxDirectors: number;
  maxManagers: number;
  maxSellers: number;
  /** Agentes de IA incluídos no pacote (sem add-ons). */
  includedAgents: number;
  /**
   * Agentes de Disparos incluídos. Cota SEPARADA de `includedAgents`: o agente
   * de disparos não atende lead novo, ele resgata base antiga com prompt
   * próprio. Fazer os dois dividirem a mesma cota tirava do plano Solo metade
   * do atendimento normal só para poder disparar.
   */
  includedBroadcastAgents: number;
  maxSalesFunnels: number;
  /** Leads atendidos/mês (contagem de cobrança). */
  monthlyAttendedLeadsCap: number;
  /** Linhas WhatsApp incluídas na base do plano (API oficial). */
  includedWhatsAppLines: number;
};

const POLICY: Record<NormalizedPlan, PlanLimits> = {
  solo: {
    maxDirectors: 0,
    maxManagers: 0,
    maxSellers: 0,
    includedAgents: 2,
    includedBroadcastAgents: 1,
    maxSalesFunnels: 5,
    monthlyAttendedLeadsCap: 500,
    includedWhatsAppLines: 2,
  },
  equipa: {
    maxDirectors: 1,
    maxManagers: 3,
    maxSellers: 30,
    includedAgents: 5,
    includedBroadcastAgents: 1,
    maxSalesFunnels: 12,
    monthlyAttendedLeadsCap: 5000,
    includedWhatsAppLines: 2,
  },
  escala: {
    maxDirectors: 5,
    maxManagers: 25,
    maxSellers: 30,
    includedAgents: 30,
    includedBroadcastAgents: 1,
    maxSalesFunnels: 25,
    monthlyAttendedLeadsCap: 15000,
    includedWhatsAppLines: 2,
  },
  enterprise: {
    maxDirectors: 5,
    maxManagers: 25,
    maxSellers: 30,
    includedAgents: 30,
    includedBroadcastAgents: 1,
    maxSalesFunnels: 100,
    monthlyAttendedLeadsCap: 100_000,
    includedWhatsAppLines: 2,
  },
};

export function normalizeToPlan(
  plan: NormalizedPlan | "profissional" | "master" | (string & {}),
): NormalizedPlan {
  if (plan === "profissional") return "equipa";
  if (plan === "master") return "escala";
  if (plan === "solo" || plan === "equipa" || plan === "escala" || plan === "enterprise") {
    return plan as NormalizedPlan;
  }
  return "equipa";
}

export function getPlanPolicy(plan: NormalizedPlan | "profissional" | "master" | (string & {})): PlanLimits {
  return POLICY[normalizeToPlan(plan)];
}

/** Plano com checkout online (derivado de `SALES_PLANS` em `lib/plans.ts`). */
export function isCheckoutPlanSlug(slug: string): boolean {
  return PLAN_CHECKOUT_SLUGS.includes(slug.trim());
}

export function maxCollaboratorsTotal(limits: PlanLimits): number {
  return limits.maxDirectors + limits.maxManagers + limits.maxSellers;
}
