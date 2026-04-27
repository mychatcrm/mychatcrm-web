import type { PlanLimits } from "@/lib/plan-policy";
import type { EnterpriseProvisionLimits } from "@/lib/enterprise-provision-types";

/** Valor usado internamente quando o admin marca «sem limite» (null). */
export const ENTERPRISE_UNLIMITED_NUM = 99_999_999;

export function enterpriseLimitsToPlanLimits(limits: EnterpriseProvisionLimits): PlanLimits {
  const n = (v: number | null, fallback: number) =>
    v === null || v === undefined ? ENTERPRISE_UNLIMITED_NUM : Math.max(0, Math.floor(v));

  return {
    maxDirectors: n(limits.maxDirectors, 0),
    maxManagers: n(limits.maxManagers, 0),
    maxSellers: n(limits.maxSellers, 0),
    includedAgents: n(limits.includedAgents, 0),
    maxSalesFunnels: n(limits.maxSalesFunnels, 0),
    monthlyAttendedLeadsCap: n(limits.monthlyAttendedLeadsCap, 0),
    includedWhatsAppLines: n(limits.includedWhatsAppLines, 1),
  };
}
