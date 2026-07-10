import "server-only";

import type { ClientPlan } from "@/lib/client-auth";
import { enterpriseLimitsToPlanLimits } from "@/lib/enterprise-provision-limits";
import type { PlanLimits } from "@/lib/plan-policy";
import { normalizeToPlan } from "@/lib/plan-policy";
import { readEnterpriseProvisionByTenant } from "@/lib/server/enterprise-provisions-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Server-only commercial snapshot for webhooks and jobs, which do not have a
 * signed browser session. It deliberately uses the tenant's persisted plan.
 */
export async function getTenantPlanSnapshot(tenantId: string): Promise<{
  plan: ClientPlan;
  operationalLimits?: PlanLimits;
}> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenants")
    .select("billing_plan")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`[tenant-plan-snapshot] tenant:${error.message}`);
  const plan = normalizeToPlan(typeof data?.billing_plan === "string" ? data.billing_plan : "equipa") as ClientPlan;
  if (plan !== "enterprise") return { plan };
  const provision = await readEnterpriseProvisionByTenant(tenantId);
  return {
    plan,
    operationalLimits: provision ? enterpriseLimitsToPlanLimits(provision.limits) : undefined,
  };
}
