import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Footer } from "@/components/landing/Footer";
import { JsonLd } from "@/components/JsonLd";
import { SalesSiteHeader } from "@/components/plans/SalesSiteHeader";
import { getPlanBySlug, parsePlanBillingCycle, PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { SITE_URL } from "@/lib/constants";
import { buildBreadcrumbSchema } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { CheckoutView } from "./CheckoutView";

export function generateStaticParams() {
  const localeParams = routing.locales.flatMap((locale) =>
    PLAN_CHECKOUT_SLUGS.map((planSlug) => ({ locale, planSlug })),
  );
  return localeParams;
}

type PageProps = {
  params: Promise<{ locale: string; planSlug: string }>;
  searchParams?: Promise<{ ciclo?: string | string[] }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, planSlug } = await params;
  const plan = getPlanBySlug(planSlug);
  if (!plan) {
    return { title: "Plano não encontrado | MyChatCRM", robots: { index: false, follow: false } };
  }
  const t = await getTranslations({ locale, namespace: "seo.checkout" });

  return {
    title: t("title", { planName: plan.name }),
    description: t("description", { planName: plan.name }),
    robots: { index: false, follow: false },
    alternates: { canonical: `/checkout/${plan.slug}` },
    openGraph: {
      title: t("title", { planName: plan.name }),
      url: `${SITE_URL}/checkout/${plan.slug}`,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: `MyChatCRM — Checkout ${plan.name}` }],
    },
  };
}

export default async function CheckoutPage({ params, searchParams }: PageProps) {
  const { planSlug, locale } = await params;
  const resolvedSearchParams = await searchParams;
  const plan = getPlanBySlug(planSlug);
  if (!plan || plan.contactOnly || plan.priceMonthly == null) notFound();

  const cicloRaw = resolvedSearchParams?.ciclo;
  const ciclo = Array.isArray(cicloRaw) ? cicloRaw[0] : cicloRaw;
  const billingCycle = parsePlanBillingCycle(ciclo);

  const summary = {
    slug: plan.slug,
    name: plan.name,
    priceMonthly: plan.priceMonthly,
    tagline: plan.tagline,
    billingCycle,
  };

  const tSeo = await getTranslations({ locale, namespace: "seo.schemas" });

  const structuredData = [
    buildBreadcrumbSchema([
      { name: tSeo("breadcrumb.home"), path: "/" },
      { name: tSeo("breadcrumb.plans"), path: "/planos" },
      { name: `Checkout ${plan.name}`, path: `/checkout/${plan.slug}` },
    ]),
  ];

  return (
    <>
      {structuredData.map((data, i) => (
        <JsonLd key={`checkout-ld-${i}`} data={data} />
      ))}
      <SalesSiteHeader />
      <main className="min-h-[calc(100dvh-4rem)] bg-surface-base px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="mx-auto max-w-5xl">
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
              <li className="text-content-secondary">Checkout · {plan.name}</li>
            </ol>
          </nav>
          <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-content sm:text-4xl">
            Checkout seguro
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-content-muted">
            Você está assinando o plano <strong className="text-content-secondary">{plan.name}</strong>
            {billingCycle === "annual" ? (
              <>
                {" "}
                no <strong className="text-content-secondary">ciclo anual</strong> — total de 12 meses (bruto, desconto
                e valor a pagar no resumo ao lado).
              </>
            ) : null}
            . Revise os dados e conclua o pagamento simulado abaixo.
          </p>
          <div className="mt-10">
            <CheckoutView plan={summary} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
