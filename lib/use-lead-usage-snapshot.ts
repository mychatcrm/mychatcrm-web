"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { ClientPlan } from "@/lib/client-auth";
import type { PlanLimits } from "@/lib/plan-policy";
import {
  getServerLeadUsageSnapshot,
  subscribeLeadUsageSnapshot,
  type LeadUsageSnapshot,
} from "@/lib/dashboard-lead-usage";

async function fetchLeadUsageFromApi(): Promise<LeadUsageSnapshot | null> {
  try {
    const res = await fetch("/api/client/lead-usage", { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { used?: unknown; bonus?: unknown };
    const used =
      typeof data.used === "number" && Number.isFinite(data.used) ? Math.max(0, Math.floor(data.used)) : 0;
    const bonus =
      typeof data.bonus === "number" && Number.isFinite(data.bonus) ? Math.max(0, Math.floor(data.bonus)) : 0;
    return { used, bonus };
  } catch {
    return null;
  }
}

/**
 * Uso de leads no ciclo mensal: hidratação inicial 0/0 (SSR), depois GET `/api/client/lead-usage`.
 */
export function useLeadUsageSnapshot(
  tenantId: string,
  plan: ClientPlan,
  operationalLimits?: PlanLimits | null,
): LeadUsageSnapshot {
  const [snap, setSnap] = useState<LeadUsageSnapshot>(() => getServerLeadUsageSnapshot(plan, operationalLimits));

  const refresh = useCallback(async () => {
    const next = await fetchLeadUsageFromApi();
    if (next) setSnap(next);
  }, []);

  useLayoutEffect(() => {
    setSnap(getServerLeadUsageSnapshot(plan, operationalLimits));
    void refresh();
  }, [tenantId, plan, operationalLimits, refresh]);

  useEffect(() => {
    return subscribeLeadUsageSnapshot(() => {
      void refresh();
    });
  }, [refresh]);

  return snap;
}
