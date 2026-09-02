import type { Metadata } from "next";
import { getPlanBySlug, PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { McxSuccessShell } from "./McxSuccessShell";
import { routing } from "@/i18n/routing";
import { CheckoutSuccessView } from "./CheckoutSuccessView";

export const metadata: Metadata = {
  title: "Pagamento confirmado | MyChatCRM",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    PLAN_CHECKOUT_SLUGS.map((planSlug) => ({ locale, planSlug })),
  );
}

type PageProps = {
  params: Promise<{ locale: string; planSlug: string }>;
  searchParams?: Promise<{ session_id?: string }>;
};

export default async function CheckoutSuccessPage({ params, searchParams }: PageProps) {
  const { planSlug } = await params;
  const resolvedSearch = await searchParams;
  const sessionId = resolvedSearch?.session_id ?? null;

  const plan = getPlanBySlug(planSlug);

  return (
    <>
      <McxSuccessShell>
        <CheckoutSuccessView
          planName={plan?.name ?? planSlug}
          sessionId={sessionId}
        />
      </McxSuccessShell>
    </>
  );
}
