import { NextResponse } from "next/server";
import { ADMIN_STRIPE_JSON_HEADERS, enforceAdminFinanceStripe } from "@/lib/server/admin-stripe-route-helper";
import { parseStripeAdminSearchParams } from "@/lib/server/admin-stripe-query";
import { cachedFinanceAggregate } from "@/lib/server/admin-stripe-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await enforceAdminFinanceStripe("financeiro");
  if (auth.error) return auth.error;

  const q = parseStripeAdminSearchParams(new URL(request.url).searchParams);
  if ("error" in q) return NextResponse.json({ error: q.error }, { status: 400 });

  try {
    const cacheKey = `stripe_finance_aggregate:${q.fromSec}:${q.toSec}`;
    const payload = await cachedFinanceAggregate(cacheKey, q.fromSec, q.toSec);
    return NextResponse.json(payload, { headers: ADMIN_STRIPE_JSON_HEADERS });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao consultar Stripe.";
    console.error("[admin/stripe/financeiro]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
