import { NextResponse } from "next/server";
import { ADMIN_STRIPE_JSON_HEADERS, enforceAdminFinanceStripe } from "@/lib/server/admin-stripe-route-helper";
import { parseStripeAdminSearchParams } from "@/lib/server/admin-stripe-query";
import { listChurnSubscriptionsAdmin } from "@/lib/server/admin-stripe-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await enforceAdminFinanceStripe("churn");
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const q = parseStripeAdminSearchParams(url.searchParams);
  if ("error" in q) return NextResponse.json({ error: q.error }, { status: 400 });

  try {
    const payload = await listChurnSubscriptionsAdmin({
      fromSec: q.fromSec,
      toSec: q.toSec,
      limit: q.limit,
      cursor: q.cursor,
      planSlug: q.planSlug,
    });
    return NextResponse.json(
      {
        range: { from: q.fromIso, to: q.toIso },
        rows: payload.rows,
        nextCursor: payload.nextCursor,
        hasMore: payload.hasMore,
      },
      { headers: ADMIN_STRIPE_JSON_HEADERS },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao consultar Stripe.";
    console.error("[admin/stripe/churn]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
