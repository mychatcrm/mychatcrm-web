import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { parseCouponUpsert } from "@/lib/commercial/admin-payloads";
import { countCommittedRedemptionsForCoupon, normalizeCouponCode } from "@/lib/commercial/engine";
import { applyCouponPartnerLink } from "@/lib/commercial/sync-links";
import {
  appendAuditEntry,
  buildCommercialStoreFromDb,
  countRedemptionsByCoupon,
  insertExtraCode,
  listAllExtraCodes,
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

  const [coupons, partners, redemptions, extraCodes] = await Promise.all([
    listCoupons(),
    listPartners(),
    listRedemptions(),
    listAllExtraCodes(),
  ]);

  const store = { version: 1 as const, coupons, partners, redemptions, extraCodes, auditLog: [] };
  const stats = coupons.map((c) => ({
    couponId: c.id,
    code: c.code,
    committedRedemptions: countCommittedRedemptionsForCoupon(store, c.id),
  }));

  return NextResponse.json({
    coupons,
    partners,
    redemptionStats: stats,
    redemptions: redemptions.filter((r) => r.status !== "voided").slice(-200).reverse(),
    extraCodes,
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

  try {
    await upsertCoupon(parsed.coupon);
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : "Erro ao salvar cupom no banco.";
    console.error("[admin-coupons] Falha ao gravar cupom:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

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
        duration,
        ...(duration === "repeating" && coupon.recurringCyclesLimit
          ? { duration_in_months: coupon.recurringCyclesLimit }
          : {}),
        ...(coupon.discountType === "percent"
          ? { percent_off: coupon.discountValue }
          : { amount_off: coupon.discountValue, currency: "brl" }),
        ...(coupon.maxRedemptionsTotal ? { max_redemptions: coupon.maxRedemptionsTotal } : {}),
        ...(coupon.validUntil
          ? { redeem_by: Math.floor(new Date(coupon.validUntil).getTime() / 1000) }
          : {}),
        ...(coupon.stripeProductIds.length > 0
          ? { applies_to: { products: coupon.stripeProductIds } }
          : {}),
      });

      parsed.coupon.stripeCouponId = stripeCoupon.id;

      if (coupon.createPublicCode) {
        // Lookup do cliente no Stripe quando email restrito especificado
        let stripeCustomerId: string | undefined;
        if (coupon.restrictedCustomerEmail) {
          const customers = await stripe.customers.list({
            email: coupon.restrictedCustomerEmail,
            limit: 1,
          });
          if (!customers.data.length) {
            return NextResponse.json(
              { error: `Cliente "${coupon.restrictedCustomerEmail}" não encontrado no Stripe.` },
              { status: 400 },
            );
          }
          stripeCustomerId = customers.data[0].id;
        }

        // Parâmetros de restrictions compartilhados entre código principal e extras
        const promoRestrictions: {
          first_time_transaction?: boolean;
          minimum_amount?: number;
          minimum_amount_currency?: string;
        } = {};
        if (coupon.firstTimeOnly) promoRestrictions.first_time_transaction = true;
        if (coupon.minimumAmountBrl) {
          promoRestrictions.minimum_amount = coupon.minimumAmountBrl;
          promoRestrictions.minimum_amount_currency = "brl";
        }

        const basePromoParams = {
          promotion: { type: "coupon" as const, coupon: stripeCoupon.id },
          active: true,
          ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
          ...(Object.keys(promoRestrictions).length > 0 ? { restrictions: promoRestrictions } : {}),
        };

        const promoCode = await stripe.promotionCodes.create({
          ...basePromoParams,
          code: coupon.code,
        });
        parsed.coupon.stripePromoCodeId = promoCode.id;

        // Extra codes — mesmo Coupon Stripe, PromoCodes separados
        for (const extraCodeStr of parsed.extraCodes) {
          const extraPromo = await stripe.promotionCodes
            .create({ ...basePromoParams, code: extraCodeStr })
            .catch((err: unknown) => {
              console.warn("[admin-coupons] Falha ao criar extra code no Stripe:", extraCodeStr, err);
              return null;
            });
          await insertExtraCode({
            id: `exc_${randomUUID()}`,
            couponId: parsed.coupon.id,
            code: extraCodeStr,
            stripePromoCodeId: extraPromo?.id ?? null,
            createdAt: new Date().toISOString(),
          });
        }
      }

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
