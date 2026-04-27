"use client";

import { Suspense, useState } from "react";
import { BillingCycleToggle } from "@/components/plans/BillingCycleToggle";
import { Skeleton } from "@/components/ui/Skeleton";
import { PLAN_ANNUAL_DISCOUNT_PERCENT, type PlanBillingCycle } from "@/lib/plans";
import { PlansGrid } from "./PlansGrid";

function PlansGridFallback() {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-8">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[420px] rounded-3xl" />
      ))}
    </div>
  );
}

export function PlansPricingBlock() {
  const [billingCycle, setBillingCycle] = useState<PlanBillingCycle>("monthly");

  return (
    <>
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pt-8 sm:px-6 lg:px-8">
        <BillingCycleToggle value={billingCycle} onChange={setBillingCycle} />
        <p className="mt-3 max-w-md text-center text-xs text-content-muted sm:text-sm">
          {billingCycle === "monthly"
            ? "Preços por mês, cobrança mensal."
            : `Equivalente mensal com ${PLAN_ANNUAL_DISCOUNT_PERCENT}% de desconto no ciclo anual — faturamento anual (12 meses).`}
        </p>
      </div>

      <div className="mt-12">
        <Suspense fallback={<PlansGridFallback />}>
          <PlansGrid billingCycle={billingCycle} />
        </Suspense>
      </div>
    </>
  );
}
