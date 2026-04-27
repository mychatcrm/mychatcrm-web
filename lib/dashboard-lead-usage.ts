import type { ClientPlan } from "@/lib/client-auth";
import { formatIntegerPtBr } from "@/lib/format-number";
import type { PlanLimits } from "@/lib/plan-policy";
import { getPlanMonthlyConversationCap, normalizeClientPlan } from "@/lib/plan-limits";

export const LEADS_USAGE_UPDATED_EVENT = "mychatcrm-leads-usage-updated";

const STORAGE_PREFIX = "mychatcrm.leads.usage.v2.";

function sanitizeTenantId(tenantId: string) {
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "tenant";
}

function storageKey(tenantId: string) {
  return `${STORAGE_PREFIX}${sanitizeTenantId(tenantId)}`;
}

export type LeadUsageSnapshot = {
  /** Leads atendidos contados no ciclo de faturação (demo). */
  used: number;
  /** Limite extra comprado ou concedido além do pacote do plano (demo). */
  bonus: number;
};

/** Limite mensal de leads atendidos incluídos no plano (base de cobrança). */
export function planMonthlyLeadAllowance(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): number {
  const p = normalizeClientPlan(plan);
  return getPlanMonthlyConversationCap(p, operationalLimits);
}

function defaultUsedForAllowance(cap: number) {
  const ratio = 0.28 + (cap % 47) / 200;
  return Math.min(Math.floor(cap * ratio), Math.max(0, cap - 1));
}

function normalizeSnapshot(
  raw: unknown,
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): LeadUsageSnapshot {
  const cap = planMonthlyLeadAllowance(plan, operationalLimits);
  if (!raw || typeof raw !== "object") {
    return { used: defaultUsedForAllowance(cap), bonus: 0 };
  }
  const o = raw as Record<string, unknown>;
  const used =
    typeof o.used === "number" && Number.isFinite(o.used) && o.used >= 0 ? Math.floor(o.used) : defaultUsedForAllowance(cap);
  const bonus = typeof o.bonus === "number" && Number.isFinite(o.bonus) && o.bonus >= 0 ? Math.floor(o.bonus) : 0;
  return { used, bonus };
}

/** Snapshot determinístico para SSR e `getServerSnapshot` na hidratação. */
export function getServerLeadUsageSnapshot(
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): LeadUsageSnapshot {
  return normalizeSnapshot(null, plan, operationalLimits);
}

export function subscribeLeadUsageSnapshot(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const fn = () => onStoreChange();
  window.addEventListener(LEADS_USAGE_UPDATED_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(LEADS_USAGE_UPDATED_EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

export function readLeadUsageSnapshot(
  tenantId: string,
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): LeadUsageSnapshot {
  if (typeof window === "undefined") {
    return getServerLeadUsageSnapshot(plan, operationalLimits);
  }
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId));
    if (!raw) return getServerLeadUsageSnapshot(plan, operationalLimits);
    return normalizeSnapshot(JSON.parse(raw) as unknown, plan, operationalLimits);
  } catch {
    return getServerLeadUsageSnapshot(plan, operationalLimits);
  }
}

export function seedLeadUsageSnapshotIfEmpty(
  tenantId: string,
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const key = storageKey(tenantId);
    if (window.localStorage.getItem(key) !== null) return;
    window.localStorage.setItem(key, JSON.stringify(getServerLeadUsageSnapshot(plan, operationalLimits)));
  } catch {
    /* ignore */
  }
}

export function persistLeadUsageSnapshot(tenantId: string, snap: LeadUsageSnapshot) {
  if (typeof window === "undefined") return;
  try {
    const clean: LeadUsageSnapshot = {
      used: Math.max(0, Math.floor(snap.used)),
      bonus: Math.max(0, Math.min(Math.floor(snap.bonus), 9_000_000)),
    };
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(clean));
    window.dispatchEvent(new Event(LEADS_USAGE_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

export function addBonusLeadAllowance(
  tenantId: string,
  plan: ClientPlan | "profissional" | "master",
  amount: number,
  operationalLimits?: PlanLimits | null,
): LeadUsageSnapshot {
  const add = Math.max(0, Math.floor(amount));
  const cur = readLeadUsageSnapshot(tenantId, plan, operationalLimits);
  const next: LeadUsageSnapshot = { ...cur, bonus: cur.bonus + add };
  persistLeadUsageSnapshot(tenantId, next);
  return next;
}

export function leadsUsageStorageKey(tenantId: string) {
  return storageKey(tenantId);
}

export function formatLeadCount(n: number) {
  return formatIntegerPtBr(n);
}
