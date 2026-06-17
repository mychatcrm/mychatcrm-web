/** Modelo comercial: cupons, parceiros e resgates (fonte de verdade no servidor). */

export type DiscountRecurrence = "first_cycle" | "all_cycles";

/** Periodicidade de checkout permitida pelo cupom. Vazio = mensal e anual. */
export type CouponPeriodicity = "monthly" | "yearly";

export type CouponExtraCode = {
  id: string;
  couponId: string;
  code: string;
  stripePromoCodeId: string | null;
  createdAt: string;
};

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
  /** Vazio = mensal e anual. Valores: "monthly" | "yearly". */
  allowedPeriodicities: CouponPeriodicity[];
  discountRecurrence: DiscountRecurrence;
  /** Com `all_cycles`: quantos ciclos mensais o desconto vale; `null` = sem limite explícito (contrato). */
  recurringCyclesLimit: number | null;
  active: boolean;
  partnerId: string | null;
  stripeCouponId: string | null;
  stripePromoCodeId: string | null;
  /** Product IDs do Stripe para applies_to.products. Vazio = sem restrição de produto. */
  stripeProductIds: string[];
  /** Se false, não cria PromotionCode no Stripe — cupom interno sem código público. */
  createPublicCode: boolean;
  /** Somente para o primeiro pedido do cliente no Stripe (restrictions.first_time_transaction). */
  firstTimeOnly: boolean;
  /** Email do cliente no Stripe para restrictions.customer — null = sem restrição. */
  restrictedCustomerEmail: string | null;
  /** Valor mínimo do pedido em menor unidade da moeda (restrictions.minimum_amount) — null = sem mínimo. */
  minimumAmountCents: number | null;
  /** Moeda ISO do valor mínimo (restrictions.minimum_amount_currency). */
  minimumAmountCurrency: string | null;
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

export type RedemptionStatus = "pending" | "committed" | "confirmed" | "voided";

export type CouponRedemption = {
  id: string;
  createdAt: string;
  status: RedemptionStatus;
  idempotencyKey: string;
  couponId: string | null;
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
  extraCodes: CouponExtraCode[];
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
  | "COUPON_PERIOD_NOT_ALLOWED"
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
  /** Preenchido pela validate route, não pelo engine. */
  stripePromoCodeId?: string | null;
  message: string;
};

export type CouponValidateResult = CouponValidateFailure | CouponValidateSuccess;
