import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/landing/Footer";
import { SalesSiteHeader } from "@/components/plans/SalesSiteHeader";
import { getPlanBySlug, PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
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
      <SalesSiteHeader />
      <main className="min-h-[calc(100dvh-4rem)] bg-surface-base px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="mx-auto max-w-2xl">
          <nav className="text-xs text-content-muted" aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/" className="transition hover:text-primary">
                  Início
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li>
                <Link href="/planos" className="transition hover:text-primary">
                  Planos
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li className="text-content-secondary">Pagamento confirmado</li>
            </ol>
          </nav>

          <div className="mt-10">
            <CheckoutSuccessView
              planName={plan?.name ?? planSlug}
              sessionId={sessionId}
            />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
