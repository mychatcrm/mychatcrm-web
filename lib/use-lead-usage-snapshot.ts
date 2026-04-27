"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type { ClientPlan } from "@/lib/client-auth";
import type { PlanLimits } from "@/lib/plan-policy";
import {
  getServerLeadUsageSnapshot,
  readLeadUsageSnapshot,
  seedLeadUsageSnapshotIfEmpty,
  subscribeLeadUsageSnapshot,
  type LeadUsageSnapshot,
} from "@/lib/dashboard-lead-usage";

/**
 * Snapshot de uso de leads atendidos no ciclo (demo).
 *
 * **Hidratação:** o primeiro paint do cliente deve coincidir com o SSR.
 * Não usar `useSyncExternalStore` com `getSnapshot` lendo `localStorage` — isso quebra a regra
 * de que `getServerSnapshot` === primeiro `getSnapshot` na hidratação quando há dados gravados.
 */
export function useLeadUsageSnapshot(
  tenantId: string,
  plan: ClientPlan,
  operationalLimits?: PlanLimits | null,
): LeadUsageSnapshot {
  const [snap, setSnap] = useState<LeadUsageSnapshot>(() => getServerLeadUsageSnapshot(plan, operationalLimits));

  useLayoutEffect(() => {
    setSnap(readLeadUsageSnapshot(tenantId, plan, operationalLimits));
  }, [tenantId, plan, operationalLimits]);

  useEffect(() => {
    seedLeadUsageSnapshotIfEmpty(tenantId, plan, operationalLimits);
  }, [tenantId, plan, operationalLimits]);

  useEffect(() => {
    return subscribeLeadUsageSnapshot(() => {
      setSnap(readLeadUsageSnapshot(tenantId, plan, operationalLimits));
    });
  }, [tenantId, plan, operationalLimits]);

  return snap;
}
