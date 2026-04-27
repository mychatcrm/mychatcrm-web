import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { countCommittedRedemptionsForCoupon } from "@/lib/commercial/engine";
import { applyCouponPartnerLink } from "@/lib/commercial/sync-links";
import { appendAudit, readCommercialStore, writeCommercialStore } from "@/lib/server/commercial-store-fs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await context.params;
  const store = readCommercialStore();
  const coupon = store.coupons.find((c) => c.id === id);
  if (!coupon) return NextResponse.json({ error: "Cupom não encontrado." }, { status: 404 });

  if (countCommittedRedemptionsForCoupon(store, coupon.id) > 0) {
    return NextResponse.json(
      { error: "Não é possível excluir: já existem resgates confirmados. Desative o cupom." },
      { status: 409 },
    );
  }

  const ghost = { ...coupon, partnerId: null as string | null };
  let next: typeof store = {
    ...store,
    coupons: store.coupons.filter((c) => c.id !== id),
  };
  next = applyCouponPartnerLink(next, { ...ghost, id: ghost.id });
  next = appendAudit(next, {
    adminId: session.adminId,
    adminEmail: session.email,
    action: "coupon_delete",
    detail: coupon.code,
  });
  writeCommercialStore(next);
  return NextResponse.json({ ok: true });
}
