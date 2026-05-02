import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  brlToCents,
  computeCommissionCents,
  findPartner,
  findRedemptionByIdempotencyKey,
  normalizeCouponCode,
  validateCouponForCheckout,
} from "@/lib/commercial/engine";
import {
  appendAuditEntry,
  buildCommercialStoreFromDb,
  insertRedemption,
} from "@/lib/server/commercial-store-db";
import { parsePlanBillingCycle, planCheckoutChargeBaseBRL, SALES_PLANS } from "@/lib/plans";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    planSlug?: string;
    email?: string;
    idempotencyKey?: string;
    ciclo?: string;
    billingCycle?: string;
  } | null;

  const planSlug = typeof body?.planSlug === "string" ? body.planSlug.trim() : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!planSlug || !email) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "E-mail e plano são obrigatórios para concluir o pedido." },
      { status: 400 },
    );
  }

  if (!normalizeCouponCode(code)) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "Cupom opcional — sem código não há nada a registar." },
      { status: 400 },
    );
  }

  if (!idempotencyKey) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "Chave de idempotência ausente — recarregue a página e tente novamente." },
      { status: 400 },
    );
  }

  const plan = SALES_PLANS.find((p) => p.slug === planSlug);
  if (!plan || plan.priceMonthly === null) {
    return NextResponse.json({ ok: false, code: "PLAN_NOT_CHECKOUT", message: "Plano sem checkout." }, { status: 400 });
  }

  const store = await buildCommercialStoreFromDb();
  const existing = findRedemptionByIdempotencyKey(store, idempotencyKey);
  if (existing && existing.status === "committed") {
    return NextResponse.json({
      ok: true,
      idempotent: true,
      redemptionId: existing.id,
      finalCents: existing.finalCents,
      discountCents: existing.discountCents,
    });
  }

  const billingCycle = parsePlanBillingCycle(body?.ciclo ?? body?.billingCycle);
  const originalCents = brlToCents(planCheckoutChargeBaseBRL(plan.priceMonthly, billingCycle));
  const validated = validateCouponForCheckout({ store, codeRaw: code, planSlug, originalCents, emailRaw: email });

  if (!validated.ok) {
    return NextResponse.json(validated, { status: 422 });
  }

  const coupon = store.coupons.find((c) => c.id === validated.couponId);
  if (!coupon) {
    return NextResponse.json({ ok: false, code: "COUPON_INVALID", message: "Cupom não encontrado." }, { status: 422 });
  }

  const partner = findPartner(store, validated.partnerId);
  const commissionCents = computeCommissionCents(partner, validated.finalCents, validated.discountCents);

  const redemption = {
    id: `red_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    status: "committed" as const,
    idempotencyKey,
    couponId: coupon.id,
    codeNormalized: coupon.code,
    planSlug,
    emailNormalized: email.toLowerCase(),
    originalCents: validated.originalCents,
    discountCents: validated.discountCents,
    finalCents: validated.finalCents,
    partnerId: validated.partnerId,
    commissionCents,
  };

  await insertRedemption(redemption);
  await appendAuditEntry({
    id: `aud_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    adminId: "checkout-system",
    adminEmail: "checkout@system",
    action: "coupon_commit",
    detail: JSON.stringify({ couponId: coupon.id, planSlug, email: redemption.emailNormalized }),
  });

  return NextResponse.json({
    ok: true,
    idempotent: false,
    redemptionId: redemption.id,
    finalCents: validated.finalCents,
    discountCents: validated.discountCents,
    commissionCents,
  });
}
