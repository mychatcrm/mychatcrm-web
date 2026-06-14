import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { parseCouponUpsert } from "@/lib/commercial/admin-payloads";
import { countCommittedRedemptionsForCoupon, normalizeCouponCode } from "@/lib/commercial/engine";
import { applyCouponPartnerLink } from "@/lib/commercial/sync-links";
import {
  appendAuditEntry,
  buildCommercialStoreFromDb,
  countRedemptionsByCoupon,
  listCoupons,
  listPartners,
  listRedemptions,
  persistModifiedPartners,
  upsertCoupon,
} from "@/lib/server/commercial-store-db";
import { getStripe } from "@/lib/stripe";
import { randomUUID } from "crypto";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const [coupons, partners, redemptions] = await Promise.all([
    listCoupons(),
    listPartners(),
    listRedemptions(),
  ]);

  const store = { version: 1 as const, coupons, partners, redemptions, auditLog: [] };
  const stats = coupons.map((c) => ({
    couponId: c.id,
    code: c.code,
    committedRedemptions: countCommittedRedemptionsForCoupon(store, c.id),
  }));

  return NextResponse.json({
    coupons,
    partners,
    redemptionStats: stats,
    redemptions: redemptions.filter((r) => r.status === "committed").slice(-200).reverse(),
  });
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const store = await buildCommercialStoreFromDb();
  const existing = typeof body?.id === "string" ? store.coupons.find((c) => c.id === body.id) : undefined;
  const parsed = parseCouponUpsert(body, existing);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const codeNorm = normalizeCouponCode(parsed.coupon.code);
  const duplicate = store.coupons.some((c) => c.code === codeNorm && c.id !== parsed.coupon.id);
  if (duplicate) {
    return NextResponse.json({ error: "Já existe um cupom com este código." }, { status: 409 });
  }

  if (parsed.coupon.partnerId) {
    const partner = store.partners.find((p) => p.id === parsed.coupon.partnerId);
    if (!partner) {
      return NextResponse.json({ error: "Parceiro vinculado não encontrado." }, { status: 400 });
    }
  }

  await upsertCoupon(parsed.coupon);

  // Sincronizar com o Stripe apenas na primeira criação (sem stripeCouponId ainda)
  if (!existing?.stripeCouponId) {
    try {
      const stripe = getStripe();
      const coupon = parsed.coupon;

      const durationMap = {
        first_cycle: "once",
        all_cycles: coupon.recurringCyclesLimit ? "repeating" : "forever",
      } as const;
      const duration = durationMap[coupon.discountRecurrence];

      const stripeCoupon = await stripe.coupons.create({
        name: coupon.internalName,
        currency: "brl",
        duration,
        ...(duration === "repeating" && coupon.recurringCyclesLimit
          ? { duration_in_months: coupon.recurringCyclesLimit }
          : {}),
        ...(coupon.discountType === "percent"
          ? { percent_off: coupon.discountValue }
          : { amount_off: coupon.discountValue }),
      });
      const promoCode = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: stripeCoupon.id },
        code: coupon.code,
        active: true,
      });

      parsed.coupon.stripeCouponId = stripeCoupon.id;
      parsed.coupon.stripePromoCodeId = promoCode.id;
      await upsertCoupon(parsed.coupon);
    } catch (stripeErr) {
      console.error("[admin-coupons] Falha ao criar no Stripe:", stripeErr);
      // Cupom salvo no DB mas sem IDs Stripe — não bloqueia a criação
    }
  }

  const updated = applyCouponPartnerLink(store, parsed.coupon);
  const changedPartners = updated.partners.filter(
    (p, i) => JSON.stringify(p) !== JSON.stringify(store.partners[i]),
  );
  if (changedPartners.length > 0) {
    await persistModifiedPartners(changedPartners);
  }

  await appendAuditEntry({
    id: `aud_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    adminId: session.adminId,
    adminEmail: session.email,
    action: existing ? "coupon_upsert" : "coupon_create",
    detail: parsed.coupon.code,
  });

  return NextResponse.json({ ok: true, coupon: parsed.coupon });
}
