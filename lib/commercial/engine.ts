import { isCheckoutPlanSlug } from "@/lib/plan-policy";
import type { CouponPeriodicity } from "@/lib/commercial/types";
import type {
  CommercialCoupon,
  CommercialPartner,
  CommercialStore,
  CouponRedemption,
  CouponValidateFailure,
  CouponValidateResult,
  CouponValidateSuccess,
} from "@/lib/commercial/types";

export function normalizeCouponCode(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}

/** BRL decimal → centavos inteiros (evita float). */
export function brlToCents(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

export function centsToBrl(cents: number) {
  return cents / 100;
}

function fail(code: CouponValidateFailure["code"], message: string): CouponValidateFailure {
  return { ok: false, code, message };
}

function parseDayStart(iso: string | null) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function parseDayEnd(iso: string | null) {
  if (!iso) return null;
  const d = new Date(`${iso}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function countCommittedRedemptionsForCoupon(store: CommercialStore, couponId: string) {
  return store.redemptions.filter((r) => r.couponId === couponId && r.status === "committed").length;
}

export function countCommittedRedemptionsForUserOnCoupon(
  store: CommercialStore,
  couponId: string,
  emailNormalized: string,
) {
  if (!emailNormalized) return 0;
  return store.redemptions.filter(
    (r) => r.couponId === couponId && r.status === "committed" && r.emailNormalized === emailNormalized,
  ).length;
}

export function computeDiscountCents(originalCents: number, coupon: CommercialCoupon) {
  if (originalCents <= 0) return 0;
  if (coupon.discountType === "percent") {
    const p = Math.min(100, Math.max(0, coupon.discountValue));
    return Math.min(originalCents, Math.floor((originalCents * p) / 100));
  }
  const fixed = Math.max(0, Math.floor(coupon.discountValue));
  return Math.min(originalCents, fixed);
}

export function findPartner(store: CommercialStore, partnerId: string | null): CommercialPartner | null {
  if (!partnerId) return null;
  return store.partners.find((p) => p.id === partnerId) ?? null;
}

/**
 * Comissão calculada sobre o valor líquido pago no ciclo (anti-inflação em cima do desconto).
 * Em produção, alinhar com contrato (percent sobre bruto, sobre MRR, etc.).
 */
export function computeCommissionCents(
  partner: CommercialPartner | null,
  finalCents: number,
  discountCents: number,
): number {
  if (!partner || partner.status !== "active" || !partner.campaignActive) return 0;
  if (finalCents <= 0 && discountCents <= 0) return 0;
  const base = Math.max(0, finalCents);
  if (partner.commissionType === "fixed") {
    return Math.min(base, Math.max(0, Math.floor(partner.commissionValue)));
  }
  const pct = Math.min(100, Math.max(0, partner.commissionValue));
  return Math.min(base, Math.floor((base * pct) / 100));
}

export function validateCouponForCheckout(params: {
  store: CommercialStore;
  codeRaw: string;
  planSlug: string;
  originalCents: number;
  emailRaw?: string | null;
  nowMs?: number;
  checkoutPeriodicity?: CouponPeriodicity;
}): CouponValidateResult {
  const { store, planSlug, originalCents } = params;
  const nowMs = params.nowMs ?? Date.now();
  const code = normalizeCouponCode(params.codeRaw);
  if (!code) {
    return fail("COUPON_EMPTY", "Cupom opcional — digite um código para validar ou continue sem cupom.");
  }

  if (!isCheckoutPlanSlug(planSlug)) {
    return fail("PLAN_NOT_CHECKOUT", "Este plano não possui checkout online.");
  }

  const coupon = store.coupons.find((c) => c.code === code);
  if (!coupon) return fail("COUPON_INVALID", "Cupom não encontrado.");

  if (!coupon.active) return fail("COUPON_INACTIVE", "Cupom inativo.");

  const from = parseDayStart(coupon.validFrom);
  const until = parseDayEnd(coupon.validUntil);
  if (from !== null && nowMs < from) {
    return fail("COUPON_NOT_STARTED", "Cupom ainda não está válido.");
  }
  if (until !== null && nowMs > until) {
    return fail("COUPON_EXPIRED", "Cupom expirado.");
  }

  if (coupon.allowedPlanSlugs.length > 0 && !coupon.allowedPlanSlugs.includes(planSlug)) {
    return fail("COUPON_PLAN_NOT_ALLOWED", "Cupom não se aplica a este plano.");
  }

  if (coupon.allowedPeriodicities.length > 0) {
    const period = params.checkoutPeriodicity;
    if (!period || !coupon.allowedPeriodicities.includes(period)) {
      return fail("COUPON_PERIOD_NOT_ALLOWED", "Cupom não se aplica a esta periodicidade de cobrança.");
    }
  }

  if (coupon.maxRedemptionsTotal !== null) {
    const used = countCommittedRedemptionsForCoupon(store, coupon.id);
    if (used >= coupon.maxRedemptionsTotal) {
      return fail("COUPON_LIMIT_REACHED", "Limite total de usos atingido.");
    }
  }

  const emailNorm = params.emailRaw ? normalizeEmail(params.emailRaw) : "";
  if (coupon.maxRedemptionsPerUser !== null && coupon.maxRedemptionsPerUser > 0) {
    if (!emailNorm) {
      return fail("EMAIL_REQUIRED_FOR_COUPON", "Informe o e-mail para aplicar este cupom.");
    }
    const userUses = countCommittedRedemptionsForUserOnCoupon(store, coupon.id, emailNorm);
    if (userUses >= coupon.maxRedemptionsPerUser) {
      return fail("COUPON_USER_LIMIT_REACHED", "Limite de usos por conta atingido.");
    }
  }

  const discountCents = computeDiscountCents(originalCents, coupon);
  const finalCents = Math.max(0, originalCents - discountCents);

  const success: CouponValidateSuccess = {
    ok: true,
    couponId: coupon.id,
    code: coupon.code,
    planSlug,
    originalCents,
    discountCents,
    finalCents,
    discountRecurrence: coupon.discountRecurrence,
    recurringCyclesLimit: coupon.recurringCyclesLimit,
    partnerId: coupon.partnerId,
    message:
      coupon.discountRecurrence === "first_cycle"
        ? "Desconto aplicado ao primeiro ciclo de cobrança."
        : "Desconto aplicado em todos os ciclos enquanto vigente no contrato.",
  };

  return success;
}

export function findRedemptionByIdempotencyKey(store: CommercialStore, key: string): CouponRedemption | null {
  const k = key.trim();
  if (!k) return null;
  return store.redemptions.find((r) => r.idempotencyKey === k) ?? null;
}
