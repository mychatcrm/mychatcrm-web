import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { parseCouponUpsert } from "@/lib/commercial/admin-payloads";
import { countCommittedRedemptionsForCoupon, normalizeCouponCode } from "@/lib/commercial/engine";
import { applyCouponPartnerLink } from "@/lib/commercial/sync-links";
import {
  appendAuditEntry,
  buildCommercialStoreFromDb,
  listAllExtraCodes,
  listCoupons,
  listPartners,
  listRedemptions,
  persistModifiedPartners,
  upsertCoupon,
} from "@/lib/server/commercial-store-db";
import {
  createCouponWithStripe,
  findDuplicateCodes,
  isSafeEditOnly,
  mergeSafeCouponEdit,
  type PromoCodeCreateOptions,
} from "@/lib/server/create-coupon";
import { randomUUID } from "crypto";
import { isStripeCurrency, normalizeStripeCurrency } from "@/lib/commercial/stripe-currencies";

function parseMinimumAmountCents(o: Record<string, unknown>): number | null {
  if (typeof o.minimumAmountCents === "number" && o.minimumAmountCents >= 0) {
    return Math.floor(o.minimumAmountCents);
  }
  if (typeof o.minimumAmountBrl === "number" && o.minimumAmountBrl >= 0) {
    return Math.floor(o.minimumAmountBrl);
  }
  return null;
}

function parsePromoCodeCreateOptions(raw: unknown): PromoCodeCreateOptions | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const minimumAmountCents = parseMinimumAmountCents(o);
  return {
    firstTimeOnly: o.firstTimeOnly === true,
    restrictedCustomerEmail:
      typeof o.restrictedCustomerEmail === "string" && o.restrictedCustomerEmail.trim()
        ? o.restrictedCustomerEmail.trim()
        : null,
    minimumAmountCents,
    minimumAmountCurrency:
      minimumAmountCents != null
        ? typeof o.minimumAmountCurrency === "string" && isStripeCurrency(o.minimumAmountCurrency)
          ? normalizeStripeCurrency(o.minimumAmountCurrency)
          : "brl"
        : null,
    promoMaxRedemptions:
      typeof o.promoMaxRedemptions === "number" && o.promoMaxRedemptions >= 1
        ? Math.floor(o.promoMaxRedemptions)
        : null,
    promoExpiresAt:
      typeof o.promoExpiresAt === "string" && o.promoExpiresAt.trim() ? o.promoExpiresAt : null,
  };
}

function parseExtraPromoConfigs(raw: unknown): PromoCodeCreateOptions[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parsePromoCodeCreateOptions).filter((x): x is PromoCodeCreateOptions => x != null);
}

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

  if (parsed.coupon.partnerId) {
    const partner = store.partners.find((p) => p.id === parsed.coupon.partnerId);
    if (!partner) {
      return NextResponse.json({ error: "Parceiro vinculado não encontrado." }, { status: 400 });
    }
  }

  // ── Edição segura (cupom existente) ─────────────────────────────────────
  if (existing) {
    if (!isSafeEditOnly(existing, parsed.coupon)) {
      return NextResponse.json(
        {
          error:
            "Campos de desconto, código e restrições Stripe não podem ser alterados após a criação. Use «Sincronizar Stripe» se o cupom não tiver promo vinculada.",
        },
        { status: 400 },
      );
    }

    const updated = mergeSafeCouponEdit(existing, parsed.coupon);
    try {
      await upsertCoupon(updated);
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : "Erro ao atualizar cupom no banco.";
      console.error("[admin-coupons] Falha ao atualizar cupom:", msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const linked = applyCouponPartnerLink(store, updated);
    const changedPartners = linked.partners.filter(
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
      action: "coupon_upsert",
      detail: updated.code,
    });

    return NextResponse.json({ ok: true, coupon: updated });
  }

  // ── Criação nova ────────────────────────────────────────────────────────
  const codeNorm = normalizeCouponCode(parsed.coupon.code);
  const dup = findDuplicateCodes(store, codeNorm, parsed.extraCodes);
  if (dup) {
    return NextResponse.json({ error: `Já existe um cupom ou código extra com «${dup}».` }, { status: 409 });
  }

  const createResult = await createCouponWithStripe(
    parsed.coupon,
    parsed.extraCodes,
    {
      promoMaxRedemptions:
        typeof body?.promoMaxRedemptions === "number" && body.promoMaxRedemptions >= 1
          ? Math.floor(body.promoMaxRedemptions)
          : null,
      promoExpiresAt:
        typeof body?.promoExpiresAt === "string" && body.promoExpiresAt.trim()
          ? body.promoExpiresAt
          : null,
    },
    parseExtraPromoConfigs(body?.extraPromoConfigs),
  );
  if (!createResult.ok) {
    return NextResponse.json({ error: createResult.error }, { status: createResult.status });
  }

  const linked = applyCouponPartnerLink(store, createResult.coupon);
  const changedPartners = linked.partners.filter(
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
    action: "coupon_create",
    detail: createResult.coupon.code,
  });

  return NextResponse.json({ ok: true, coupon: createResult.coupon });
}
