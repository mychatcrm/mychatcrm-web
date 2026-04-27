import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/landing/Footer";
import { JsonLd } from "@/components/JsonLd";
import { SalesSiteHeader } from "@/components/plans/SalesSiteHeader";
import { getPlanBySlug, parsePlanBillingCycle, PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { SITE_URL } from "@/lib/constants";
import { buildBreadcrumbSchema } from "@/lib/seo";
import { CheckoutView } from "./CheckoutView";

export function generateStaticParams() {
  return PLAN_CHECKOUT_SLUGS.map((planSlug) => ({ planSlug }));
}

type PageProps = {
  params: { planSlug: string };
  searchParams?: { ciclo?: string | string[] };
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const plan = getPlanBySlug(params.planSlug);
  if (!plan) {
    return { title: "Plano não encontrado | MyChatCRM", robots: { index: false, follow: false } };
  }
  return {
    title: `Checkout — ${plan.name} | MyChatCRM`,
    description: `Finalize a assinatura do plano ${plan.name} no MyChatCRM.`,
    robots: { index: false, follow: false },
    alternates: { canonical: `/checkout/${plan.slug}` },
    openGraph: {
      title: `Checkout ${plan.name}`,
      url: `${SITE_URL}/checkout/${plan.slug}`,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: `MyChatCRM — Checkout ${plan.name}` }],
    },
  };
}

export default function CheckoutPage({ params, searchParams }: PageProps) {
  const plan = getPlanBySlug(params.planSlug);
  if (!plan || plan.contactOnly || plan.priceMonthly == null) notFound();

  const cicloRaw = searchParams?.ciclo;
  const ciclo = Array.isArray(cicloRaw) ? cicloRaw[0] : cicloRaw;
  const billingCycle = parsePlanBillingCycle(ciclo);

  const summary = {
    slug: plan.slug,
    name: plan.name,
    priceMonthly: plan.priceMonthly,
    tagline: plan.tagline,
    billingCycle,
  };

  const structuredData = [
    buildBreadcrumbSchema([
      { name: "Início", path: "/" },
      { name: "Planos", path: "/planos" },
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
