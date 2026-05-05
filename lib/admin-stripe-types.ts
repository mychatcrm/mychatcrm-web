/**
 * DTOs serializáveis para o admin financeiro (Stripe).
 */

export type AdminStripePagamentoRow = {
  id: string;
  created: string;
  amountCents: number;
  currency: string;
  amountDisplay: string;
  status: string;
  paid: boolean;
  refundedCents: number;
  disputed: boolean;
  customerId: string | null;
  customerLabel: string;
  invoiceId: string | null;
  outcomeType: string | null;
  failureMessage: string | null;
};

export type AdminStripeFaturaRow = {
  id: string | null;
  number: string | null;
  created: string;
  status: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  amountDueDisplay: string;
  hostedInvoiceUrl: string | null;
  customerId: string | null;
  customerLabel: string;
  subscriptionId: string | null;
  /** Price IDs detectados nos itens (para filtro de plano). */
  priceIds: string[];
};

export type AdminStripeChurnRow = {
  subscriptionId: string;
  customerId: string | null;
  customerLabel: string;
  canceledAt: string | null;
  endedAt: string | null;
  /** Valor mensal equivalente estimado (centavos), a partir dos itens da assinatura. */
  estimatedMonthlyCents: number | null;
  currency: string;
  priceIds: string[];
};

export type AdminFinanceiroDailyPoint = {
  day: string;
  grossCents: number;
  refundedCents: number;
};

export type AdminStripeFinanceiroPayload = {
  range: { from: string; to: string };
  kpis: {
    grossChargesCents: number;
    totalRefundedCents: number;
    netChargesCents: number;
    succeededChargeCount: number;
    failedPaymentIntentCount: number;
    openOrLostDisputeCharges: number;
    invoicesPaidCount: number;
    invoicesOpenCount: number;
    invoicesUncollectibleCount: number;
    canceledSubscriptionsInRange: number;
    estimatedMonthlyRecurringCanceledCents: number;
    currency: string;
  };
  seriesDaily: AdminFinanceiroDailyPoint[];
};

export type PaginatedStripeResult<T> = {
  rows: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type AdminStripeOverviewPayload = AdminStripeFinanceiroPayload["kpis"] & {
  range: AdminStripeFinanceiroPayload["range"];
};
