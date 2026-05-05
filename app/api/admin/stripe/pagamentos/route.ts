import { NextResponse } from "next/server";
import { ADMIN_STRIPE_JSON_HEADERS, enforceAdminFinanceStripe } from "@/lib/server/admin-stripe-route-helper";
import { parseStripeAdminSearchParams } from "@/lib/server/admin-stripe-query";
import { listChargesAdmin } from "@/lib/server/admin-stripe-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await enforceAdminFinanceStripe("pagamentos");
  if (auth.error) return auth.error;

  const q = parseStripeAdminSearchParams(new URL(request.url).searchParams);
  if ("error" in q) return NextResponse.json({ error: q.error }, { status: 400 });

  try {
    const payload = await listChargesAdmin({
      fromSec: q.fromSec,
      toSec: q.toSec,
      limit: q.limit,
      cursor: q.cursor,
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
    console.error("[admin/stripe/pagamentos]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
