/**
 * Sincroniza cupons ativos sem stripe_promo_code_id com o Stripe.
 *
 * Uso: npx tsx scripts/sync-coupon-stripe-promos.ts
 * Requer: STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 */
import { listCoupons } from "../lib/server/commercial-store-db";
import { syncCouponToStripe } from "../lib/server/sync-coupon-stripe";

async function main() {
  const coupons = await listCoupons();
  const orphans = coupons.filter(
    (c) => c.active && c.createPublicCode && (!c.stripeCouponId || !c.stripePromoCodeId),
  );

  if (orphans.length === 0) {
    console.log("Nenhum cupom ativo sem sync Stripe.");
    return;
  }

  console.log(`Encontrados ${orphans.length} cupom(ns) para sincronizar:`);
  for (const coupon of orphans) {
    console.log(`- ${coupon.code} (${coupon.id})`);
    const result = await syncCouponToStripe(coupon);
    if (result.ok) {
      console.log(`  OK: promo=${result.coupon.stripePromoCodeId} created=${result.created}`);
    } else {
      console.error(`  ERRO: ${result.error}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
