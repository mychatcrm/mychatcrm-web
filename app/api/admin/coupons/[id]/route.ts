import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { applyCouponPartnerLink } from "@/lib/commercial/sync-links";
import {
  appendAuditEntry,
  buildCommercialStoreFromDb,
  deleteCoupon,
  persistModifiedPartners,
} from "@/lib/server/commercial-store-db";
import { getStripe } from "@/lib/stripe";
import { randomUUID } from "crypto";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await context.params;
  const store = await buildCommercialStoreFromDb();
  const coupon = store.coupons.find((c) => c.id === id);
  if (!coupon) return NextResponse.json({ error: "Cupom não encontrado." }, { status: 404 });

  const ghost = { ...coupon, partnerId: null as string | null };
  const updated = applyCouponPartnerLink(
    { ...store, coupons: store.coupons.filter((c) => c.id !== id) },
    ghost,
  );
  const changedPartners = updated.partners.filter(
    (p, i) => JSON.stringify(p) !== JSON.stringify(store.partners[i]),
  );
  if (changedPartners.length > 0) {
    await persistModifiedPartners(changedPartners);
  }

  if (coupon.stripePromoCodeId) {
    getStripe().promotionCodes.update(coupon.stripePromoCodeId, { active: false }).catch(
      (err: unknown) => console.warn("[admin-coupons] Falha ao desativar promo code no Stripe:", err),
    );
  }
  if (coupon.stripeCouponId) {
    getStripe().coupons.del(coupon.stripeCouponId).catch(
      (err: unknown) => console.warn("[admin-coupons] Falha ao deletar coupon no Stripe:", err),
    );
  }

  await deleteCoupon(id);
  await appendAuditEntry({
    id: `aud_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    adminId: session.adminId,
    adminEmail: session.email,
    action: "coupon_delete",
    detail: coupon.code,
  });

  return NextResponse.json({ ok: true });
}
