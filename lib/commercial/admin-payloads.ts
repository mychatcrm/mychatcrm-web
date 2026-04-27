import { randomUUID } from "crypto";
import { isCheckoutPlanSlug } from "@/lib/plan-policy";
import type { CommercialCoupon, CommercialPartner } from "@/lib/commercial/types";
import { normalizeCouponCode } from "@/lib/commercial/engine";

function isoNow() {
  return new Date().toISOString();
}

export function parseCouponUpsert(
  body: unknown,
  existing: CommercialCoupon | undefined,
): { ok: true; coupon: CommercialCoupon } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Payload inválido." };
  const r = body as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id ? r.id : `cpn_${randomUUID().slice(0, 12)}`;
  const code = normalizeCouponCode(typeof r.code === "string" ? r.code : "");
  if (!code) return { ok: false, error: "Código do cupom é obrigatório." };

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

  const validFrom = typeof r.validFrom === "string" && r.validFrom.trim() ? r.validFrom.trim() : null;
  const validUntil = typeof r.validUntil === "string" && r.validUntil.trim() ? r.validUntil.trim() : null;

  const maxRedemptionsTotal =
    r.maxRedemptionsTotal === null || r.maxRedemptionsTotal === ""
      ? null
      : typeof r.maxRedemptionsTotal === "number"
        ? r.maxRedemptionsTotal
        : parseInt(String(r.maxRedemptionsTotal), 10);
  if (maxRedemptionsTotal !== null && (!Number.isFinite(maxRedemptionsTotal) || maxRedemptionsTotal < 0)) {
    return { ok: false, error: "Limite total inválido." };
  }

  const maxRedemptionsPerUser =
    r.maxRedemptionsPerUser === null || r.maxRedemptionsPerUser === ""
      ? null
      : typeof r.maxRedemptionsPerUser === "number"
        ? r.maxRedemptionsPerUser
        : parseInt(String(r.maxRedemptionsPerUser), 10);
  if (maxRedemptionsPerUser !== null && (!Number.isFinite(maxRedemptionsPerUser) || maxRedemptionsPerUser < 0)) {
    return { ok: false, error: "Limite por usuário inválido." };
  }

  let allowedPlanSlugs: string[] = [];
  if (Array.isArray(r.allowedPlanSlugs)) {
    allowedPlanSlugs = r.allowedPlanSlugs.filter((s): s is string => typeof s === "string" && isCheckoutPlanSlug(s));
  }
  const discountRecurrence = r.discountRecurrence === "all_cycles" ? "all_cycles" : "first_cycle";
  const recurringCyclesLimit =
    r.recurringCyclesLimit === null || r.recurringCyclesLimit === ""
      ? null
      : typeof r.recurringCyclesLimit === "number"
        ? r.recurringCyclesLimit
        : parseInt(String(r.recurringCyclesLimit), 10);
  if (recurringCyclesLimit !== null && (!Number.isFinite(recurringCyclesLimit) || recurringCyclesLimit < 1)) {
    return { ok: false, error: "Limite de ciclos inválido." };
  }

  const active = r.active !== false;
  const partnerId =
    typeof r.partnerId === "string" && r.partnerId.trim() ? r.partnerId.trim() : null;

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
    discountRecurrence,
    recurringCyclesLimit,
    active,
    partnerId,
    createdAt: existing?.createdAt ?? isoNow(),
    updatedAt: isoNow(),
  };

  return { ok: true, coupon };
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
