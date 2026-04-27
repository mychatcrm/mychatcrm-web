import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { parseCouponUpsert } from "@/lib/commercial/admin-payloads";
import { countCommittedRedemptionsForCoupon, normalizeCouponCode } from "@/lib/commercial/engine";
import { applyCouponPartnerLink } from "@/lib/commercial/sync-links";
import { appendAudit, readCommercialStore, writeCommercialStore } from "@/lib/server/commercial-store-fs";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const store = readCommercialStore();
  const stats = store.coupons.map((c) => ({
    couponId: c.id,
    code: c.code,
    committedRedemptions: countCommittedRedemptionsForCoupon(store, c.id),
  }));

  return NextResponse.json({
    coupons: store.coupons,
    partners: store.partners,
    redemptionStats: stats,
    redemptions: store.redemptions.filter((r) => r.status === "committed").slice(-200).reverse(),
  });
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const existingStore = readCommercialStore();
  const existing = typeof body?.id === "string" ? existingStore.coupons.find((c) => c.id === body.id) : undefined;
  const parsed = parseCouponUpsert(body, existing);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const codeNorm = normalizeCouponCode(parsed.coupon.code);
  const duplicate = existingStore.coupons.some((c) => c.code === codeNorm && c.id !== parsed.coupon.id);
  if (duplicate) {
    return NextResponse.json({ error: "Já existe um cupom com este código." }, { status: 409 });
  }

  if (parsed.coupon.partnerId) {
    const partner = existingStore.partners.find((p) => p.id === parsed.coupon.partnerId);
    if (!partner) {
      return NextResponse.json({ error: "Parceiro vinculado não encontrado." }, { status: 400 });
    }
  }

  let next: typeof existingStore = {
    ...existingStore,
    coupons: existingStore.coupons.some((c) => c.id === parsed.coupon.id)
      ? existingStore.coupons.map((c) => (c.id === parsed.coupon.id ? parsed.coupon : c))
      : [...existingStore.coupons, parsed.coupon],
  };

  next = applyCouponPartnerLink(next, parsed.coupon);
  next = appendAudit(next, {
    adminId: session.adminId,
    adminEmail: session.email,
    action: existing ? "coupon_upsert" : "coupon_create",
    detail: parsed.coupon.code,
  });

  writeCommercialStore(next);
  return NextResponse.json({ ok: true, coupon: parsed.coupon });
}
