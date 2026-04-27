/** Modelo comercial: cupons, parceiros e resgates (fonte de verdade no servidor). */

export type DiscountRecurrence = "first_cycle" | "all_cycles";

export type CommercialCoupon = {
  id: string;
  /** Código normalizado em maiúsculas, sem espaços laterais. */
  code: string;
  internalName: string;
  description: string;
  discountType: "percent" | "fixed";
  /** Percentual 0–100 ou valor fixo em centavos (BRL). */
  discountValue: number;
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptionsTotal: number | null;
  maxRedemptionsPerUser: number | null;
  /** Vazio = todos os planos com checkout. */
  allowedPlanSlugs: string[];
  discountRecurrence: DiscountRecurrence;
  /** Com `all_cycles`: quantos ciclos mensais o desconto vale; `null` = sem limite explícito (contrato). */
  recurringCyclesLimit: number | null;
  active: boolean;
  partnerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PartnerStatus = "active" | "inactive";

export type CommissionType = "percent" | "fixed";

/** `once` = só sobre o primeiro pagamento confirmado; `recurring` = sobre cada ciclo enquanto aplicável. */
export type CommissionTiming = "once" | "recurring";

export type CommercialPartner = {
  id: string;
  name: string;
  /** Referência curta (slug interno). */
  code: string;
  email: string;
  socialNotes: string;
  status: PartnerStatus;
  observations: string;
  startedAt: string;
  commissionType: CommissionType;
  /** Percentual 0–100 ou centavos fixos por evento de comissão. */
  commissionValue: number;
  commissionTiming: CommissionTiming;
  commissionRecurrenceMonths: number | null;
  campaignActive: boolean;
  linkedCouponIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type RedemptionStatus = "committed" | "voided";

export type CouponRedemption = {
  id: string;
  createdAt: string;
  status: RedemptionStatus;
  idempotencyKey: string;
  couponId: string;
  codeNormalized: string;
  planSlug: string;
  emailNormalized: string;
  originalCents: number;
  discountCents: number;
  finalCents: number;
  partnerId: string | null;
  commissionCents: number;
};

export type CommercialAuditEntry = {
  id: string;
  createdAt: string;
  adminId: string;
  adminEmail: string;
  action: string;
  detail: string;
};

export type CommercialStore = {
  version: 1;
  coupons: CommercialCoupon[];
  partners: CommercialPartner[];
  redemptions: CouponRedemption[];
  auditLog: CommercialAuditEntry[];
};

export type CouponRejectCode =
  | "COUPON_EMPTY"
  | "COUPON_INVALID"
  | "COUPON_INACTIVE"
  | "COUPON_NOT_STARTED"
  | "COUPON_EXPIRED"
  | "COUPON_LIMIT_REACHED"
  | "COUPON_USER_LIMIT_REACHED"
  | "COUPON_PLAN_NOT_ALLOWED"
  | "EMAIL_REQUIRED_FOR_COUPON"
  | "PLAN_NOT_CHECKOUT";

export type CouponValidateFailure = {
  ok: false;
  code: CouponRejectCode;
  message: string;
};

export type CouponValidateSuccess = {
  ok: true;
  couponId: string;
  code: string;
  planSlug: string;
  originalCents: number;
  discountCents: number;
  finalCents: number;
  discountRecurrence: DiscountRecurrence;
  recurringCyclesLimit: number | null;
  partnerId: string | null;
  message: string;
};

export type CouponValidateResult = CouponValidateFailure | CouponValidateSuccess;
