import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import type {
  AdminFinanceiroDailyPoint,
  AdminStripeChurnRow,
  AdminStripeFaturaRow,
  AdminStripeFinanceiroPayload,
  AdminStripeOverviewPayload,
  AdminStripePagamentoRow,
  PaginatedStripeResult,
} from "@/lib/admin-stripe-types";
import { resolveAdminPlanPriceFilter } from "@/lib/stripe-prices";
import { withAdminStripeCache } from "@/lib/server/admin-stripe-cache";

function formatMinorUnits(currency: string, amountCents: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `${amountCents / 100} ${currency}`;
  }
}

function dayKeyFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function customerLabel(customer: Stripe.Charge["customer"] | Stripe.Invoice["customer"]): string {
  if (typeof customer !== "object" || !customer) return "—";
  if ("deleted" in customer && customer.deleted) return `${customer.id} (removido)`;
  if ("email" in customer && typeof customer.email === "string" && customer.email.trim()) return customer.email.trim();
  if ("name" in customer && typeof customer.name === "string" && customer.name.trim()) return customer.name.trim();
  return customer.id;
}

function customerId(customer: Stripe.Charge["customer"] | Stripe.Invoice["customer"]): string | null {
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) return customer.id ?? null;
  return null;
}

function subscriptionPriceIds(sub: Stripe.Subscription | string | null | undefined): string[] {
  if (!sub || typeof sub === "string") return [];
  return (sub.items?.data ?? [])
    .map((si) => (typeof si.price === "object" && si.price?.id ? si.price.id : null))
    .filter(Boolean) as string[];
}

type InvoiceLineMaybePrice = Stripe.Invoice["lines"]["data"][number] | { price?: string | Stripe.Price | null };

type InvoiceMaybeSubscription = Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };

type ChargeCompat = Stripe.Charge & {
  dispute?: string | Stripe.Dispute | null;
  invoice?: string | Stripe.Invoice | null;
};

function invoiceLinePriceIds(inv: Stripe.Invoice): string[] {
  return ((inv.lines?.data ?? []) as InvoiceLineMaybePrice[])
    .map((line) => {
      const p =
        typeof line === "object" && line && "price" in line ? (line as { price?: string | Stripe.Price | null }).price : null;
      return typeof p === "string" ? p : typeof p === "object" && p?.id ? p.id : null;
    })
    .filter(Boolean) as string[];
}

function invoiceMatchesPlanFilter(inv: Stripe.Invoice, priceIds: string[] | null): boolean {
  if (!priceIds?.length) return true;
  const invSub = (inv as InvoiceMaybeSubscription).subscription;
  const combined = [...new Set([...invoiceLinePriceIds(inv), ...subscriptionPriceIds(invSub != null ? invSub : null)])];
  return combined.some((id) => priceIds.includes(id));
}

function outcomeType(ch: Stripe.Charge): string | null {
  const o = ch.outcome?.type ?? null;
  return o ?? null;
}

function chargeToRow(ch: Stripe.Charge): AdminStripePagamentoRow {
  const c = ch as ChargeCompat;
  const currency = ch.currency ?? "usd";
  const cust = customerLabel(ch.customer);
  const disputed = Boolean(ch.disputed ?? c.dispute);
  const invId =
    typeof c.invoice === "string"
      ? c.invoice
      : typeof c.invoice === "object" && c.invoice?.id
        ? c.invoice.id
        : null;
  const paid = Boolean(ch.paid);
  let statusLabel = paid ? "pago" : "não_pago";
  if (ch.failure_code ?? ch.failure_message) statusLabel = "falha";
  else if ((ch.amount_refunded ?? 0) > 0 && (ch.amount ?? 0) <= (ch.amount_refunded ?? 0)) statusLabel = "reembolsado";

  return {
    id: ch.id,
    created: new Date(ch.created * 1000).toISOString(),
    amountCents: ch.amount ?? 0,
    currency,
    amountDisplay: formatMinorUnits(currency, ch.amount ?? 0),
    status: statusLabel,
    paid,
    refundedCents: ch.amount_refunded ?? 0,
    disputed,
    customerId: typeof ch.customer === "string" ? ch.customer : ch.customer?.id ?? null,
    customerLabel: cust,
    invoiceId: invId,
    outcomeType: outcomeType(ch),
    failureMessage: ch.failure_message ?? null,
  };
}

function invoiceToRow(inv: Stripe.Invoice): AdminStripeFaturaRow {
  const invx = inv as InvoiceMaybeSubscription;
  const currency = inv.currency ?? "usd";
  const cust = customerLabel(inv.customer);
  const subId =
    typeof invx.subscription === "string"
      ? invx.subscription
      : typeof invx.subscription === "object" && invx.subscription?.id
        ? invx.subscription.id
        : null;
  const linePrices = invoiceLinePriceIds(inv);
  const subPrices = subscriptionPriceIds(invx.subscription != null ? invx.subscription : null);
  const priceIds = [...new Set([...linePrices, ...subPrices])];

  return {
    id: inv.id,
    number: inv.number ?? null,
    created: new Date(inv.created * 1000).toISOString(),
    status: inv.status ?? null,
    amountDueCents: inv.amount_due ?? 0,
    amountPaidCents: inv.amount_paid ?? 0,
    currency,
    amountDueDisplay: formatMinorUnits(currency, inv.amount_due ?? 0),
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    customerId: customerId(inv.customer),
    customerLabel: cust,
    subscriptionId: subId,
    priceIds,
  };
}

function estimateMonthlyFromSubscription(sub: Stripe.Subscription): { cents: number; currency: string } | null {
  let cents = 0;
  let currency = "usd";
  for (const si of sub.items?.data ?? []) {
    const p = si.price;
    if (!p?.unit_amount || !p.recurring) continue;
    currency = p.currency ?? currency;
    let monthly = p.unit_amount;
    if (p.recurring.interval === "year") monthly = Math.round(p.unit_amount / 12);
    else if (p.recurring.interval === "week") monthly = Math.round((p.unit_amount * 52) / 12);
    else if (p.recurring.interval === "day") monthly = Math.round(p.unit_amount * 30);
    cents += monthly * (si.quantity ?? 1);
  }
  return cents > 0 ? { cents, currency } : null;
}

function subscriptionMatchesPlan(sub: Stripe.Subscription, priceIds: string[] | null): boolean {
  if (!priceIds?.length) return true;
  return (sub.items?.data ?? []).some((si) => si.price?.id && priceIds.includes(si.price.id));
}

export async function listChargesAdmin(params: {
  fromSec: number;
  toSec: number;
  limit: number;
  cursor: string | null;
}): Promise<PaginatedStripeResult<AdminStripePagamentoRow>> {
  const stripe = getStripe();
  const res = await stripe.charges.list({
    created: { gte: params.fromSec, lte: params.toSec },
    limit: params.limit,
    starting_after: params.cursor ?? undefined,
    expand: ["data.customer"],
  });
  const rows = res.data.map(chargeToRow);
  const hasMore = res.has_more ?? false;
  const nextCursor =
    rows.length > 0 && hasMore ? (res.data[res.data.length - 1]?.id ?? null) : null;
  return { rows, hasMore: hasMore && !!nextCursor, nextCursor };
}

export async function listInvoicesAdmin(params: {
  fromSec: number;
  toSec: number;
  limit: number;
  cursor: string | null;
  status: string | null;
  planSlug: string | null;
}): Promise<PaginatedStripeResult<AdminStripeFaturaRow>> {
  const stripe = getStripe();
  const priceFilter = resolveAdminPlanPriceFilter(params.planSlug);
  if (Array.isArray(priceFilter) && priceFilter.length === 0) {
    return { rows: [], hasMore: false, nextCursor: null };
  }

  const statusFilter =
    params.status && params.status !== "all" ? (params.status as Stripe.Invoice.Status) : undefined;

  if (!priceFilter) {
    const res = await stripe.invoices.list({
      created: { gte: params.fromSec, lte: params.toSec },
      limit: params.limit,
      starting_after: params.cursor ?? undefined,
      status: statusFilter,
      expand: ["data.customer", "data.subscription"],
    });
    const rows = res.data.map(invoiceToRow);
    const hasMore = !!(res.has_more ?? false);
    const lastId = res.data[res.data.length - 1]?.id ?? null;
    return {
      rows,
      hasMore: hasMore && !!lastId,
      nextCursor: hasMore ? lastId : null,
    };
  }

  let startingAfter = params.cursor ?? undefined;
  const collected: AdminStripeFaturaRow[] = [];
  let stripeHasMore = true;
  let lastStripePagingId: string | null = null;

  let iterations = 0;
  while (collected.length < params.limit && stripeHasMore && iterations < 60) {
    iterations += 1;
    const page = await stripe.invoices.list({
      created: { gte: params.fromSec, lte: params.toSec },
      limit: 100,
      starting_after: startingAfter,
      status: statusFilter,
      expand: ["data.customer", "data.subscription"],
    });

    stripeHasMore = !!(page.has_more ?? false);
    const lastInv = page.data[page.data.length - 1];
    lastStripePagingId = lastInv?.id ?? lastStripePagingId;

    if (page.data.length === 0) break;

    for (const inv of page.data) {
      if (!invoiceMatchesPlanFilter(inv, priceFilter)) continue;
      collected.push(invoiceToRow(inv));
      if (collected.length >= params.limit) break;
    }

    startingAfter = lastInv?.id;
    if (!startingAfter || !stripeHasMore) break;
  }

  return {
    rows: collected,
    hasMore: stripeHasMore && !!lastStripePagingId,
    nextCursor: stripeHasMore && lastStripePagingId ? lastStripePagingId : null,
  };
}

export async function listChurnSubscriptionsAdmin(params: {
  fromSec: number;
  toSec: number;
  limit: number;
  cursor: string | null;
  planSlug: string | null;
}): Promise<PaginatedStripeResult<AdminStripeChurnRow>> {
  const stripe = getStripe();
  const priceFilter = resolveAdminPlanPriceFilter(params.planSlug);
  if (Array.isArray(priceFilter) && priceFilter.length === 0) {
    return { rows: [], hasMore: false, nextCursor: null };
  }

  let startingAfter = params.cursor ?? undefined;
  const collected: AdminStripeChurnRow[] = [];
  let stripeHasMore = true;
  let lastStripePagingId: string | null = null;

  outer: while (collected.length < params.limit && stripeHasMore) {
    const page = await stripe.subscriptions.list({
      status: "canceled",
      limit: 100,
      starting_after: startingAfter,
      expand: ["data.customer"],
    });

    stripeHasMore = !!(page.has_more ?? false);
    const last = page.data[page.data.length - 1];
    lastStripePagingId = last?.id ?? lastStripePagingId;

    if (page.data.length === 0) break;

    for (const sub of page.data) {
      const canceledMs = ((sub.canceled_at ?? sub.ended_at ?? 0) as number) * 1000;
      if (!canceledMs) continue;
      if (canceledMs < params.fromSec * 1000 || canceledMs > params.toSec * 1000) continue;
      if (!subscriptionMatchesPlan(sub, priceFilter)) continue;

      const estimated = estimateMonthlyFromSubscription(sub);
      const priceIds = (sub.items?.data ?? []).map((si) => si.price?.id).filter(Boolean) as string[];

      collected.push({
        subscriptionId: sub.id,
        customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
        customerLabel: customerLabel(sub.customer),
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
        endedAt: sub.ended_at ? new Date(sub.ended_at * 1000).toISOString() : null,
        estimatedMonthlyCents: estimated?.cents ?? null,
        currency: estimated?.currency ?? "usd",
        priceIds,
      });

      if (collected.length >= params.limit) break outer;
    }

    if (!stripeHasMore || !last) break;
    startingAfter = last.id;
  }

  return {
    rows: collected,
    hasMore: stripeHasMore && !!lastStripePagingId,
    nextCursor: stripeHasMore && lastStripePagingId ? lastStripePagingId : null,
  };
}

async function loopChargesForFinance(
  fromSec: number,
  toSec: number,
  maxPages: number,
): Promise<Stripe.Charge[]> {
  const stripe = getStripe();
  const all: Stripe.Charge[] = [];
  let starting_after: string | undefined;
  for (let p = 0; p < maxPages; p++) {
    const batch = await stripe.charges.list({
      created: { gte: fromSec, lte: toSec },
      limit: 100,
      starting_after,
    });
    all.push(...batch.data);
    if (!(batch.has_more ?? false)) break;
    const lastId = batch.data[batch.data.length - 1]?.id;
    if (!lastId) break;
    starting_after = lastId;
  }
  return all;
}

async function loopInvoicesAggregates(fromSec: number, toSec: number, status: Stripe.Invoice.Status) {
  const stripe = getStripe();
  let count = 0;
  let starting_after: string | undefined;
  let pages = 0;
  while (pages++ < 15) {
    const batch = await stripe.invoices.list({
      created: { gte: fromSec, lte: toSec },
      limit: 100,
      starting_after,
      status,
      expand: ["data.subscription"],
    });
    count += batch.data.length;
    if (!(batch.has_more ?? false)) break;
    const lastId = batch.data[batch.data.length - 1]?.id;
    if (!lastId) break;
    starting_after = lastId;
  }
  return count;
}

async function countProblemPaymentIntents(fromSec: number, toSec: number): Promise<number> {
  const stripe = getStripe();
  let n = 0;
  let starting_after: string | undefined;
  let pages = 0;
  while (pages++ < 6) {
    const batch = await stripe.paymentIntents.list({
      created: { gte: fromSec, lte: toSec },
      limit: 100,
      starting_after,
    });
    for (const pi of batch.data) {
      if (pi.last_payment_error?.message || pi.last_payment_error?.code) n++;
    }
    if (!(batch.has_more ?? false)) break;
    const lid = batch.data[batch.data.length - 1]?.id;
    if (!lid) break;
    starting_after = lid;
  }
  return n;
}

async function aggregateChurnTotals(fromSec: number, toSec: number): Promise<{ count: number; mrrCents: number; currency: string }> {
  const stripe = getStripe();
  let count = 0;
  let mrrCents = 0;
  let currency = "usd";
  let starting_after: string | undefined;
  let pages = 0;
  while (pages++ < 20) {
    const page = await stripe.subscriptions.list({ status: "canceled", limit: 100, starting_after });
    for (const sub of page.data) {
      const canceledAt = ((sub.canceled_at ?? sub.ended_at ?? 0) as number) * 1000;
      if (canceledAt < fromSec * 1000 || canceledAt > toSec * 1000) continue;
      count++;
      const est = estimateMonthlyFromSubscription(sub);
      if (est) {
        mrrCents += est.cents;
        currency = est.currency ?? currency;
      }
    }
    if (!(page.has_more ?? false)) break;
    const lastId = page.data[page.data.length - 1]?.id;
    if (!lastId) break;
    starting_after = lastId;
  }
  return { count, mrrCents, currency };
}

export async function getFinanceAggregate(fromSec: number, toSec: number): Promise<AdminStripeFinanceiroPayload> {
  const charges = await loopChargesForFinance(fromSec, toSec, 20);

  const grossChargesCents = charges.filter((c) => c.paid).reduce((acc, c) => acc + (c.amount ?? 0), 0);
  const totalRefundedCents = charges.reduce((acc, c) => acc + (c.amount_refunded ?? 0), 0);
  const netChargesCents = Math.max(0, grossChargesCents - totalRefundedCents);
  const succeededChargeCount = charges.filter((c) => c.paid).length;

  /** Cobrança com contestação (flag `disputed` no Dahlia Stripe). */
  const disputedCharges = charges.reduce((acc, c) => acc + (((c as Stripe.Charge).disputed ?? false) ? 1 : 0), 0);

  const dayMapClean = new Map<string, AdminFinanceiroDailyPoint>();
  for (const ch of charges) {
    const day = dayKeyFromUnix(ch.created);
    let point = dayMapClean.get(day);
    if (!point) {
      point = { day, grossCents: 0, refundedCents: 0 };
      dayMapClean.set(day, point);
    }
    if (ch.paid) point.grossCents += ch.amount ?? 0;
    point.refundedCents += ch.amount_refunded ?? 0;
  }

  const [failedPi, invoicesPaidCount, invoicesOpenCount, invoicesBad, churn] = await Promise.all([
    countProblemPaymentIntents(fromSec, toSec),
    loopInvoicesAggregates(fromSec, toSec, "paid"),
    loopInvoicesAggregates(fromSec, toSec, "open"),
    loopInvoicesAggregates(fromSec, toSec, "uncollectible"),
    aggregateChurnTotals(fromSec, toSec),
  ]);

  const seriesDaily = [...dayMapClean.values()].sort((a, b) => a.day.localeCompare(b.day));

  const kpisCurrency = charges[0]?.currency ?? churn.currency ?? "usd";

  return {
    range: {
      from: new Date(fromSec * 1000).toISOString(),
      to: new Date(toSec * 1000).toISOString(),
    },
    kpis: {
      grossChargesCents,
      totalRefundedCents,
      netChargesCents,
      succeededChargeCount,
      failedPaymentIntentCount: failedPi,
      openOrLostDisputeCharges: disputedCharges,
      invoicesPaidCount,
      invoicesOpenCount,
      invoicesUncollectibleCount: invoicesBad,
      canceledSubscriptionsInRange: churn.count,
      estimatedMonthlyRecurringCanceledCents: churn.mrrCents,
      currency: kpisCurrency.toLowerCase(),
    },
    seriesDaily,
  };
}

export async function cachedFinanceAggregate(
  cacheKey: string,
  fromSec: number,
  toSec: number,
): Promise<AdminStripeFinanceiroPayload> {
  return withAdminStripeCache(cacheKey, 25000, () => getFinanceAggregate(fromSec, toSec));
}

export function financePayloadToOverview(p: AdminStripeFinanceiroPayload): AdminStripeOverviewPayload {
  return { ...p.kpis, range: p.range };
}
