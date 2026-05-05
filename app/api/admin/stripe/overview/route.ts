import { NextResponse } from "next/server";
import { ADMIN_STRIPE_JSON_HEADERS, enforceAdminFinanceStripe } from "@/lib/server/admin-stripe-route-helper";
import { parseStripeAdminSearchParams } from "@/lib/server/admin-stripe-query";
import { cachedFinanceAggregate, financePayloadToOverview } from "@/lib/server/admin-stripe-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /** Overview usa mesmo agregador que `/financeiro` (rápido, cache curto); rota permite quem tenha permissão financeiro. */
  const auth = await enforceAdminFinanceStripe("financeiro");
  if (auth.error) return auth.error;

  const q = parseStripeAdminSearchParams(new URL(request.url).searchParams);
  if ("error" in q) return NextResponse.json({ error: q.error }, { status: 400 });

  try {
    const cacheKey = `stripe_finance_aggregate:${q.fromSec}:${q.toSec}`;
    const full = await cachedFinanceAggregate(cacheKey, q.fromSec, q.toSec);
    return NextResponse.json(financePayloadToOverview(full), { headers: ADMIN_STRIPE_JSON_HEADERS });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao consultar Stripe.";
    console.error("[admin/stripe/overview]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
