import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { appendAuditEntry, buildCommercialStoreFromDb } from "@/lib/server/commercial-store-db";
import { syncCouponToStripe } from "@/lib/server/sync-coupon-stripe";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await context.params;
  const store = await buildCommercialStoreFromDb();
  const coupon = store.coupons.find((c) => c.id === id);
  if (!coupon) return NextResponse.json({ error: "Cupom não encontrado." }, { status: 404 });

  const result = await syncCouponToStripe(coupon);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await appendAuditEntry({
    id: `aud_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    adminId: session.adminId,
    adminEmail: session.email,
    action: "coupon_stripe_sync",
    detail: coupon.code,
  });

  return NextResponse.json({
    ok: true,
    created: result.created,
    coupon: result.coupon,
  });
}
