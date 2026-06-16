import type { PlanBillingCycle } from "@/lib/plans";
import type { CouponPeriodicity } from "@/lib/commercial/types";

/**
 * Checkout usa planSlug base (solo/equipa/escala) + query `ciclo`/`billingCycle`.
 * Fallback: sufixos no slug (_monthly, _yearly, _annual, etc.) se existirem.
 */
export function resolveCheckoutPeriodicity(
  billingCycle: PlanBillingCycle,
  planSlug?: string,
): CouponPeriodicity {
  const slug = (planSlug ?? "").trim().toLowerCase();
  if (slug.endsWith("_yearly") || slug.endsWith("_annual") || slug.endsWith("_anual")) {
    return "yearly";
  }
  if (slug.endsWith("_monthly") || slug.endsWith("_mensal")) {
    return "monthly";
  }
  return billingCycle === "annual" ? "yearly" : "monthly";
}
