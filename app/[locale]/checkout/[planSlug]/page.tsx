import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { JsonLd } from "@/components/JsonLd";
import { McxCheckoutShell } from "./McxCheckoutShell";
import { PreLaunchWaitlist } from "./PreLaunchWaitlist";
import { isPreLaunchWaitlistEnabled } from "@/lib/server/pre-launch-config-db";
import { getPlanBySlug, parsePlanBillingCycle } from "@/lib/plans";
import { SITE_URL } from "@/lib/constants";
import { buildBreadcrumbSchema } from "@/lib/seo";
import { CheckoutView } from "./CheckoutView";

/**
 * Renderizada a cada pedido, de propósito.
 *
 * Como página estática, o modo lista de espera ficava gravado no HTML do
 * build: virar o toggle no admin não trocava nada até um novo deploy —
 * medido em produção. Sendo dinâmica, o `if` da lista de espera é avaliado
 * no pedido e o `revalidateTag` do PATCH derruba o cache de leitura na hora.
 * É uma página de pagamento com dados por visitante; não devia ser estática
 * de qualquer maneira.
 */
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ locale: string; planSlug: string }>;
  searchParams?: Promise<{ ciclo?: string | string[]; cupom?: string | string[] }>;
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

  const cupomRaw = resolvedSearchParams?.cupom;
  const initialCouponCode = Array.isArray(cupomRaw) ? cupomRaw[0] : cupomRaw;

  const summary = {
    slug: plan.slug,
    name: plan.name,
    priceMonthly: plan.priceMonthly,
    tagline: plan.tagline,
    billingCycle,
  };

  const preLaunch = await isPreLaunchWaitlistEnabled();
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
      {preLaunch ? (
        /**
         * Modo pré-lançamento: a pessoa vê a lista de espera em vez do
         * pagamento. Reversível pelo toggle em /admin/leads-lancamento — o
         * `CheckoutView` e as rotas Stripe continuam intactos logo abaixo.
         */
        <PreLaunchWaitlist
          planSlug={plan.slug}
          planName={plan.name}
          priceMonthly={plan.priceMonthly}
          billingCycle={billingCycle}
        />
      ) : (
        <McxCheckoutShell planName={plan.name} annual={billingCycle === "annual"}>
          <CheckoutView plan={summary} initialCouponCode={initialCouponCode} />
        </McxCheckoutShell>
      )}
    </>
  );
}
