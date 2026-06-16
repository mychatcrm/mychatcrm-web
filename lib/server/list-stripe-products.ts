import { getStripe } from "@/lib/stripe";

export type StripeProductOption = {
  id: string;
  name: string;
  active: boolean;
};

/** Lista todos os produtos da conta Stripe (paginação automática). */
export async function listStripeProducts(): Promise<StripeProductOption[]> {
  const stripe = getStripe();
  const items: StripeProductOption[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.products.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const product of page.data) {
      items.push({
        id: product.id,
        name: product.name?.trim() || product.id,
        active: product.active,
      });
    }
    startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (startingAfter);

  return items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
