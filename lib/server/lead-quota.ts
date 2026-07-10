import "server-only";

import type { ClientPlan } from "@/lib/client-auth";
import type { PlanLimits } from "@/lib/plan-policy";
import { getPlanMonthlyConversationCap, normalizeClientPlan } from "@/lib/plan-limits";
import { sumTenantEntitlementQuantity, listTenantBillingEntitlements } from "@/lib/server/billing-addons";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type LeadQuotaSource = "meta_form" | "whatsapp_campaign" | "crm_manual" | "whatsapp_direct";
export type LeadQuotaPeriodicity = "monthly" | "annual";

export type LeadQuotaPolicy = {
  baseLimit: number;
  periodicity: LeadQuotaPeriodicity;
};

export type LeadQuotaSnapshot = {
  cycleStart: string;
  cycleEnd: string;
  periodicity: LeadQuotaPeriodicity;
  baseLimit: number;
  recurringBonus: number;
  topupBonus: number;
  used: number;
  cap: number;
  remaining: number;
};

export type LeadQuotaAdmission = LeadQuotaSnapshot & {
  admitted: boolean;
  eventId: string | null;
  status: "reserved" | "committed" | "existing" | "blocked" | "unavailable";
  reason: string;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveLeadQuotaCycle(periodicity: LeadQuotaPeriodicity, now = new Date()): {
  cycleStart: string;
  cycleEnd: string;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  if (periodicity === "annual") {
    return {
      cycleStart: `${year}-01-01`,
      cycleEnd: `${year}-12-31`,
    };
  }
  return {
    cycleStart: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    cycleEnd: isoDate(new Date(Date.UTC(year, month + 1, 0))),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export async function resolveTenantLeadQuotaPolicy(params: {
  tenantId: string;
  plan: ClientPlan;
  operationalLimits?: PlanLimits | null;
}): Promise<LeadQuotaPolicy> {
  const fallback: LeadQuotaPolicy = {
    baseLimit: getPlanMonthlyConversationCap(params.plan, params.operationalLimits),
    periodicity: "monthly",
  };
  const sb = createSupabaseServiceClient();

  const normalizedPlan = normalizeClientPlan(params.plan);
  const { data: planRow, error: planError } = await sb
    .from("billing_plan_lead_policies")
    .select("included_leads, periodicity")
    .eq("plan_slug", normalizedPlan)
    .maybeSingle();
  if (planError) {
    // During the rollout before the migration has reached a deployment, the
    // established policy remains the safe compatibility source.
    console.warn("[lead-quota] plan_policy_query_failed", { tenant_id: params.tenantId, error: planError.message });
  }

  let baseLimit = numberOr(planRow?.included_leads, fallback.baseLimit);
  let periodicity: LeadQuotaPeriodicity = planRow?.periodicity === "annual" ? "annual" : "monthly";

  if (normalizedPlan === "enterprise") {
    const { data: enterprise, error } = await sb
      .from("enterprise_provisions")
      .select("lead_quota_periodicity")
      .eq("tenant_id", params.tenantId)
      .maybeSingle();
    if (error) {
      console.warn("[lead-quota] enterprise_policy_query_failed", { tenant_id: params.tenantId, error: error.message });
    } else if (enterprise?.lead_quota_periodicity === "annual") {
      periodicity = "annual";
    }
    // Enterprise operational limits are already part of the signed session and
    // take precedence over the generic public-plan default.
    baseLimit = getPlanMonthlyConversationCap(params.plan, params.operationalLimits);
  }

  return { baseLimit, periodicity };
}

async function resolveAddOnBonuses(params: {
  tenantId: string;
  cycleEnd: string;
  now?: Date;
}): Promise<{ recurringBonus: number; topupBonus: number }> {
  const now = params.now ?? new Date();
  let rows;
  try {
    rows = await listTenantBillingEntitlements({ tenantId: params.tenantId, kind: "lead_capacity", now });
  } catch (error) {
    // Deploys are intentionally migration-first, but an unavailable add-on
    // ledger must not make an established plan reject every incoming lead.
    console.warn("[lead-quota] entitlement_ledger_unavailable", {
      tenant_id: params.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { recurringBonus: 0, topupBonus: 0 };
  }
  const recurringBonus = sumTenantEntitlementQuantity(rows, "lead_capacity", "recurring");
  const endAt = new Date(`${params.cycleEnd}T23:59:59.999Z`).getTime();
  const topupBonus = rows
    .filter((row) => row.billing_mode === "one_time")
    .filter((row) => !row.valid_until || Date.parse(row.valid_until) >= Math.min(now.getTime(), endAt))
    .reduce((total, row) => total + row.quantity, 0);
  return { recurringBonus, topupBonus };
}

export async function getTenantLeadQuotaSnapshot(params: {
  tenantId: string;
  plan: ClientPlan;
  operationalLimits?: PlanLimits | null;
  now?: Date;
}): Promise<LeadQuotaSnapshot> {
  const policy = await resolveTenantLeadQuotaPolicy(params);
  const cycle = resolveLeadQuotaCycle(policy.periodicity, params.now);
  const bonuses = await resolveAddOnBonuses({ tenantId: params.tenantId, cycleEnd: cycle.cycleEnd, now: params.now });
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_lead_quota_cycles")
    .select("used_count, base_limit, recurring_bonus, topup_bonus, periodicity, cycle_end")
    .eq("tenant_id", params.tenantId)
    .eq("cycle_start", cycle.cycleStart)
    .maybeSingle();
  if (error) throw new Error(`[lead-quota] snapshot:${error.message}`);
  // Entitlements can be fulfilled in the middle of a cycle. The live policy
  // and ledger are therefore authoritative for capacity; the cycle row stores
  // the transactional used count and is refreshed again on the next reserve.
  const baseLimit = policy.baseLimit;
  const recurringBonus = bonuses.recurringBonus;
  const topupBonus = bonuses.topupBonus;
  const used = numberOr(data?.used_count, 0);
  const cap = baseLimit + recurringBonus + topupBonus;
  return {
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    periodicity: policy.periodicity,
    baseLimit,
    recurringBonus,
    topupBonus,
    used,
    cap,
    remaining: Math.max(0, cap - used),
  };
}

export async function reserveTenantLeadQuota(params: {
  tenantId: string;
  plan: ClientPlan;
  operationalLimits?: PlanLimits | null;
  contactKey: string;
  source: LeadQuotaSource;
  idempotencyKey: string;
  isExistingContact?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<LeadQuotaAdmission> {
  const normalizedContact = params.contactKey.replace(/\D/g, "") || params.contactKey.trim().toLowerCase();
  if (!normalizedContact) {
    return {
      admitted: false, eventId: null, status: "blocked", reason: "missing_contact_key",
      cycleStart: "", cycleEnd: "", periodicity: "monthly", baseLimit: 0, recurringBonus: 0, topupBonus: 0,
      used: 0, cap: 0, remaining: 0,
    };
  }

  const policy = await resolveTenantLeadQuotaPolicy(params);
  const cycle = resolveLeadQuotaCycle(policy.periodicity);
  const bonuses = await resolveAddOnBonuses({ tenantId: params.tenantId, cycleEnd: cycle.cycleEnd });
  const base = {
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    periodicity: policy.periodicity,
    baseLimit: policy.baseLimit,
    recurringBonus: bonuses.recurringBonus,
    topupBonus: bonuses.topupBonus,
  };
  if (params.isExistingContact) {
    const snapshot = await getTenantLeadQuotaSnapshot(params);
    return { admitted: true, eventId: null, status: "existing", reason: "existing_contact", ...snapshot };
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.rpc("reserve_tenant_lead_quota", {
    p_tenant_id: params.tenantId,
    p_cycle_start: cycle.cycleStart,
    p_cycle_end: cycle.cycleEnd,
    p_periodicity: policy.periodicity,
    p_base_limit: policy.baseLimit,
    p_recurring_bonus: bonuses.recurringBonus,
    p_topup_bonus: bonuses.topupBonus,
    p_contact_key: normalizedContact,
    p_source: params.source,
    p_idempotency_key: params.idempotencyKey,
    p_metadata: params.metadata ?? {},
  });
  if (error) {
    console.error("[lead-quota] reserve_failed", { tenant_id: params.tenantId, source: params.source, error: error.message });
    return { admitted: false, eventId: null, status: "unavailable", reason: "lead_quota_unavailable", ...base, used: 0, cap: 0, remaining: 0 };
  }
  const row = Array.isArray(data) ? data[0] : null;
  const used = numberOr(row?.used_count, 0);
  const cap = numberOr(row?.total_limit, policy.baseLimit + bonuses.recurringBonus + bonuses.topupBonus);
  return {
    ...base,
    admitted: row?.admitted === true,
    eventId: typeof row?.event_id === "string" ? row.event_id : null,
    status: row?.status === "committed" ? "committed" : row?.status === "reserved" ? "reserved" : "blocked",
    reason: typeof row?.reason === "string" ? row.reason : "lead_quota_unavailable",
    used,
    cap,
    remaining: Math.max(0, numberOr(row?.remaining, cap - used)),
  };
}

export async function commitTenantLeadQuotaReservation(params: {
  eventId: string | null;
  leadId?: string | null;
  journeyId?: string | null;
}): Promise<void> {
  if (!params.eventId) return;
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.rpc("commit_tenant_lead_quota_reservation", {
    p_event_id: params.eventId,
    p_lead_id: params.leadId ?? null,
    p_journey_id: params.journeyId ?? null,
  });
  if (error || data !== true) throw new Error(`[lead-quota] commit:${error?.message ?? "reservation_not_committed"}`);
}

export async function releaseTenantLeadQuotaReservation(eventId: string | null, reason: string): Promise<void> {
  if (!eventId) return;
  const sb = createSupabaseServiceClient();
  const { error } = await sb.rpc("release_tenant_lead_quota_reservation", {
    p_event_id: eventId,
    p_reason: reason,
  });
  if (error) console.error("[lead-quota] release_failed", { event_id: eventId, error: error.message });
}
