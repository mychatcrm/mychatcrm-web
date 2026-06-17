import { randomUUID } from "crypto";
import { isCheckoutPlanSlug } from "@/lib/plan-policy";
import { isStripeCurrency, normalizeStripeCurrency } from "@/lib/commercial/stripe-currencies";
import type { CommercialCoupon, CommercialPartner, CouponPeriodicity } from "@/lib/commercial/types";
import { normalizeCouponCode } from "@/lib/commercial/engine";

function isoNow() {
  return new Date().toISOString();
}

function normalizeIsoDateInput(raw: unknown): string | null | "invalid" {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d.toISOString();
}

function parseOptionalInt(raw: unknown): number | null | "invalid" {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return "invalid";
  return n;
}

export function parseCouponUpsert(
  body: unknown,
  existing: CommercialCoupon | undefined,
): { ok: true; coupon: CommercialCoupon; extraCodes: string[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Payload inválido." };
  const r = body as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id ? r.id : `cpn_${randomUUID().slice(0, 12)}`;
  const createPublicCode = r.createPublicCode !== false;
  let code = normalizeCouponCode(typeof r.code === "string" ? r.code : "");
  if (!code) {
    if (!createPublicCode) {
      code = `INT_${id.replace(/^cpn_/, "").toUpperCase()}`;
    } else {
      return { ok: false, error: "Código do cupom é obrigatório." };
    }
  }

  const internalName = typeof r.internalName === "string" ? r.internalName.trim() : "";
  if (!internalName) return { ok: false, error: "Nome interno é obrigatório." };

  const description = typeof r.description === "string" ? r.description.trim() : "";
  const discountType = r.discountType === "fixed" ? "fixed" : "percent";
  const discountValue = typeof r.discountValue === "number" && Number.isFinite(r.discountValue) ? r.discountValue : Number(r.discountValue);
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return { ok: false, error: "Valor de desconto inválido." };
  }
  if (discountType === "percent" && discountValue > 100) {
    return { ok: false, error: "Percentual não pode exceder 100." };
  }

  const validFrom = normalizeIsoDateInput(r.validFrom);
  if (validFrom === "invalid") {
    return { ok: false, error: "Data inicial inválida." };
  }
  const validUntil = normalizeIsoDateInput(r.validUntil);
  if (validUntil === "invalid") {
    return { ok: false, error: "Data final inválida." };
  }
  if (validFrom && validUntil && new Date(validFrom).getTime() > new Date(validUntil).getTime()) {
    return { ok: false, error: "A data final deve ser igual ou posterior à data inicial." };
  }

  const maxRedemptionsTotal = parseOptionalInt(r.maxRedemptionsTotal);
  if (maxRedemptionsTotal === "invalid" || (maxRedemptionsTotal !== null && maxRedemptionsTotal < 0)) {
    return { ok: false, error: "Limite total inválido." };
  }

  const maxRedemptionsPerUser = parseOptionalInt(r.maxRedemptionsPerUser);
  if (maxRedemptionsPerUser === "invalid" || (maxRedemptionsPerUser !== null && maxRedemptionsPerUser < 0)) {
    return { ok: false, error: "Limite por usuário inválido." };
  }

  let allowedPlanSlugs: string[] = [];
  if (Array.isArray(r.allowedPlanSlugs)) {
    allowedPlanSlugs = r.allowedPlanSlugs.filter((s): s is string => typeof s === "string" && isCheckoutPlanSlug(s));
  }
  let allowedPeriodicities: CouponPeriodicity[] = [];
  if (Array.isArray(r.allowedPeriodicities)) {
    allowedPeriodicities = r.allowedPeriodicities.filter(
      (p): p is CouponPeriodicity => p === "monthly" || p === "yearly",
    );
  }
  const discountRecurrence = r.discountRecurrence === "all_cycles" ? "all_cycles" : "first_cycle";
  const recurringCyclesLimit = parseOptionalInt(r.recurringCyclesLimit);
  if (recurringCyclesLimit === "invalid" || (recurringCyclesLimit !== null && recurringCyclesLimit < 1)) {
    return { ok: false, error: "Limite de ciclos inválido." };
  }

  const active = r.active !== false;
  const partnerId =
    typeof r.partnerId === "string" && r.partnerId.trim() ? r.partnerId.trim() : null;

  const stripeProductIds = Array.isArray(r.stripeProductIds)
    ? (r.stripeProductIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.startsWith("prod_"),
      )
    : [];

  const firstTimeOnly = r.firstTimeOnly === true;
  const restrictedCustomerEmail =
    typeof r.restrictedCustomerEmail === "string" && r.restrictedCustomerEmail.trim()
      ? r.restrictedCustomerEmail.trim().toLowerCase()
      : null;
  const minimumAmountCentsRaw =
    r.minimumAmountCents !== undefined ? parseOptionalInt(r.minimumAmountCents) : parseOptionalInt(r.minimumAmountBrl);
  if (minimumAmountCentsRaw === "invalid" || (minimumAmountCentsRaw !== null && minimumAmountCentsRaw < 0)) {
    return { ok: false, error: "Valor mínimo inválido." };
  }
  const minimumAmountCurrency =
    minimumAmountCentsRaw != null
      ? typeof r.minimumAmountCurrency === "string" && isStripeCurrency(r.minimumAmountCurrency)
        ? normalizeStripeCurrency(r.minimumAmountCurrency)
        : "brl"
      : null;
  const promoMaxRedemptions = parseOptionalInt(r.promoMaxRedemptions);
  if (promoMaxRedemptions === "invalid" || (promoMaxRedemptions !== null && promoMaxRedemptions < 1)) {
    return { ok: false, error: "Limite de resgates do código inválido." };
  }
  const promoExpiresAt = normalizeIsoDateInput(r.promoExpiresAt);
  if (promoExpiresAt === "invalid") {
    return { ok: false, error: "Data de validade do código inválida." };
  }
  const extraCodes: string[] = Array.isArray(r.extraCodes)
    ? (r.extraCodes as unknown[])
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.trim().toUpperCase().replace(/\s+/g, ""))
        .slice(0, 5)
    : [];

  const coupon: CommercialCoupon = {
    id,
    code,
    internalName,
    description,
    discountType,
    discountValue,
    validFrom,
    validUntil,
    maxRedemptionsTotal,
    maxRedemptionsPerUser,
    allowedPlanSlugs,
    allowedPeriodicities,
    discountRecurrence,
    recurringCyclesLimit,
    active,
    partnerId,
    stripeCouponId: existing?.stripeCouponId ?? null,
    stripePromoCodeId: existing?.stripePromoCodeId ?? null,
    stripeProductIds,
    createPublicCode,
    firstTimeOnly,
    restrictedCustomerEmail,
    minimumAmountCents: minimumAmountCentsRaw,
    minimumAmountCurrency,
    promoMaxRedemptions,
    promoExpiresAt,
    createdAt: existing?.createdAt ?? isoNow(),
    updatedAt: isoNow(),
  };

  return { ok: true, coupon, extraCodes };
}

export function parsePartnerUpsert(
  body: unknown,
  existing: CommercialPartner | undefined,
): { ok: true; partner: CommercialPartner } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Payload inválido." };
  const r = body as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id ? r.id : `prt_${randomUUID().slice(0, 12)}`;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return { ok: false, error: "Nome do parceiro é obrigatório." };
  const code = typeof r.code === "string" ? r.code.trim().toUpperCase().replace(/\s+/g, "") : "";
  if (!code) return { ok: false, error: "Código do parceiro é obrigatório." };
  const email = typeof r.email === "string" ? r.email.trim() : "";
  const socialNotes = typeof r.socialNotes === "string" ? r.socialNotes : "";
  const observations = typeof r.observations === "string" ? r.observations : "";
  const status: CommercialPartner["status"] = r.status === "inactive" ? "inactive" : "active";
  const startedAt = typeof r.startedAt === "string" && r.startedAt.trim() ? r.startedAt.trim() : new Date().toISOString().slice(0, 10);

  const commissionType = r.commissionType === "fixed" ? "fixed" : "percent";
  const commissionValue =
    typeof r.commissionValue === "number" && Number.isFinite(r.commissionValue)
      ? r.commissionValue
      : Number(r.commissionValue);
  if (!Number.isFinite(commissionValue) || commissionValue < 0) {
    return { ok: false, error: "Valor de comissão inválido." };
  }
  if (commissionType === "percent" && commissionValue > 100) {
    return { ok: false, error: "Comissão percentual não pode exceder 100." };
  }

  const commissionTiming = r.commissionTiming === "recurring" ? "recurring" : "once";
  const commissionRecurrenceMonths =
    r.commissionRecurrenceMonths === null || r.commissionRecurrenceMonths === ""
      ? null
      : typeof r.commissionRecurrenceMonths === "number"
        ? r.commissionRecurrenceMonths
        : parseInt(String(r.commissionRecurrenceMonths), 10);
  if (
    commissionRecurrenceMonths !== null &&
    (!Number.isFinite(commissionRecurrenceMonths) || commissionRecurrenceMonths < 1)
  ) {
    return { ok: false, error: "Meses de recorrência inválidos." };
  }

  const campaignActive = r.campaignActive !== false;
  const linkedCouponIds = Array.isArray(r.linkedCouponIds)
    ? r.linkedCouponIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  const partner: CommercialPartner = {
    id,
    name,
    code,
    email,
    socialNotes,
    status,
    observations,
    startedAt,
    commissionType,
    commissionValue,
    commissionTiming,
    commissionRecurrenceMonths,
    campaignActive,
    linkedCouponIds,
    createdAt: existing?.createdAt ?? isoNow(),
    updatedAt: isoNow(),
  };

  return { ok: true, partner };
}
