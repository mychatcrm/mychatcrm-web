import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { formatBRL } from "@/lib/utils";

export type StripeProductOption = {
  id: string;
  name: string;
  active: boolean;
  priceLabel: string | null;
};

function formatStripePriceLabel(price: Stripe.Price): string | null {
  if (price.unit_amount == null) return null;
  const amount = formatBRL(price.unit_amount / 100);
  if (!price.recurring) return amount;
  const interval =
    price.recurring.interval === "year"
      ? "ano"
      : price.recurring.interval === "month"
        ? "mês"
        : price.recurring.interval === "week"
          ? "semana"
          : price.recurring.interval;
  return `${amount}/${interval}`;
}

/** Lista todos os produtos da conta Stripe (paginação automática). */
export async function listStripeProducts(): Promise<StripeProductOption[]> {
  const stripe = getStripe();
  const items: StripeProductOption[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.products.list({
      limit: 100,
      expand: ["data.default_price"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const product of page.data) {
      const defaultPrice =
        product.default_price && typeof product.default_price === "object" ? product.default_price : null;
      items.push({
        id: product.id,
        name: product.name?.trim() || product.id,
        active: product.active,
        priceLabel: defaultPrice ? formatStripePriceLabel(defaultPrice) : null,
      });
    }
    startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (startingAfter);

  return items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
