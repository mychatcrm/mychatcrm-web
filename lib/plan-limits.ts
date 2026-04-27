/**
 * Limites operacionais por plano (painel + API).
 * Valores numéricos vêm de `lib/plan-policy.ts`; contas Enterprise podem trazer `operationalLimits` na sessão.
 */

import type { ClientPlan, ClientSession } from "@/lib/client-auth";
import {
  getPlanPolicy,
  maxCollaboratorsTotal,
  normalizeToPlan,
  type PlanLimits,
  type NormalizedPlan,
} from "@/lib/plan-policy";

export function normalizeClientPlan(plan: ClientPlan | "profissional" | "master"): ClientPlan {
  return normalizeToPlan(plan) as ClientPlan;
}

/** Resolve limites efectivos (Enterprise provisionado usa cookie da sessão). */
export function resolveEffectivePlanLimits(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): PlanLimits {
  const p = normalizeToPlan(plan) as ClientPlan;
  if (p === "enterprise" && operationalLimits) return operationalLimits;
  return getPlanPolicy(p);
}

export function resolveEffectivePlanLimitsForSession(session: Pick<ClientSession, "plan" | "operationalLimits">): PlanLimits {
  return resolveEffectivePlanLimits(session.plan, session.operationalLimits);
}

export type CollaboratorCaps = {
  maxDirectors: number;
  maxManagers: number;
  maxSellers: number;
};

export function getPlanCollaboratorCaps(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): CollaboratorCaps {
  const p = resolveEffectivePlanLimits(plan, operationalLimits);
  return {
    maxDirectors: p.maxDirectors,
    maxManagers: p.maxManagers,
    maxSellers: p.maxSellers,
  };
}

export function getPlanCollaboratorCapsForSession(session: Pick<ClientSession, "plan" | "operationalLimits">): CollaboratorCaps {
  return getPlanCollaboratorCaps(session.plan, session.operationalLimits);
}

export function getPlanMaxCollaboratorsTotal(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): number {
  return maxCollaboratorsTotal(resolveEffectivePlanLimits(plan, operationalLimits));
}

export function getPlanMaxCollaboratorsTotalForSession(session: Pick<ClientSession, "plan" | "operationalLimits">): number {
  return getPlanMaxCollaboratorsTotal(session.plan, session.operationalLimits);
}

export function getPlanIncludedAgentLimit(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): number {
  return resolveEffectivePlanLimits(plan, operationalLimits).includedAgents;
}

export function getPlanIncludedAgentLimitForSession(session: Pick<ClientSession, "plan" | "operationalLimits">): number {
  return getPlanIncludedAgentLimit(session.plan, session.operationalLimits);
}

export function getPlanMonthlyLeadCap(_plan: ClientPlan | "profissional" | "master"): null {
  return null;
}

export function getPlanMaxSalesFunnels(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): number {
  return resolveEffectivePlanLimits(plan, operationalLimits).maxSalesFunnels;
}

export function getPlanMaxSalesFunnelsForSession(session: Pick<ClientSession, "plan" | "operationalLimits">): number {
  return getPlanMaxSalesFunnels(session.plan, session.operationalLimits);
}

export function getPlanMonthlyConversationCap(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): number {
  return resolveEffectivePlanLimits(plan, operationalLimits).monthlyAttendedLeadsCap;
}

export function getPlanMonthlyConversationCapForSession(session: Pick<ClientSession, "plan" | "operationalLimits">): number {
  return getPlanMonthlyConversationCap(session.plan, session.operationalLimits);
}

export const getPlanMonthlyAttendedLeadsLimit = getPlanMonthlyConversationCap;

/** Preço por agente IA adicional além do incluído no plano (add-on mensal). */
export const EXTRA_AGENT_MONTHLY_BRL = 50;

export function getPlanIncludedWhatsAppLines(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): number {
  return resolveEffectivePlanLimits(plan, operationalLimits).includedWhatsAppLines;
}

export function getPlanIncludedWhatsAppLinesForSession(session: Pick<ClientSession, "plan" | "operationalLimits">): number {
  return getPlanIncludedWhatsAppLines(session.plan, session.operationalLimits);
}

export type { NormalizedPlan, PlanLimits };
