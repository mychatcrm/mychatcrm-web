/**
 * Mapeia plano + ciclo → Stripe Price ID.
 * Configure as env vars na Vercel com os IDs do seu dashboard Stripe.
 *
 * Exemplo:
 *   STRIPE_PRICE_SOLO_MONTHLY=price_xxx
 *   STRIPE_PRICE_SOLO_ANNUAL=price_xxx
 *   STRIPE_PRICE_EQUIPA_MONTHLY=price_xxx
 *   STRIPE_PRICE_EQUIPA_ANNUAL=price_xxx
 *   STRIPE_PRICE_ESCALA_MONTHLY=price_xxx
 *   STRIPE_PRICE_ESCALA_ANNUAL=price_xxx
 */
import type { PlanBillingCycle } from "@/lib/plans";

const ENV_KEYS: Record<string, Record<PlanBillingCycle, string>> = {
  solo: {
    monthly: "STRIPE_PRICE_SOLO_MONTHLY",
    annual: "STRIPE_PRICE_SOLO_ANNUAL",
  },
  equipa: {
    monthly: "STRIPE_PRICE_EQUIPA_MONTHLY",
    annual: "STRIPE_PRICE_EQUIPA_ANNUAL",
  },
  escala: {
    monthly: "STRIPE_PRICE_ESCALA_MONTHLY",
    annual: "STRIPE_PRICE_ESCALA_ANNUAL",
  },
};

export function getStripePriceId(planSlug: string, cycle: PlanBillingCycle): string {
  const planKeys = ENV_KEYS[planSlug];
  if (!planKeys) throw new Error(`[stripe-prices] Plano desconhecido: ${planSlug}`);
  const envKey = planKeys[cycle];
  const priceId = process.env[envKey]?.trim();
  if (!priceId) {
    throw new Error(`[stripe-prices] Variável de ambiente não configurada: ${envKey}`);
  }
  return priceId;
}

export function stripePricesConfigured(): boolean {
  return Object.values(ENV_KEYS).every((cycles) =>
    Object.values(cycles).every((key) => !!process.env[key]?.trim()),
  );
}
