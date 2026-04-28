import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LandingSectionSkeleton } from "@/components/landing/LandingSectionSkeleton";
import { JsonLd } from "@/components/JsonLd";
import { SalesSiteHeader } from "@/components/plans/SalesSiteHeader";
import { SITE_URL } from "@/lib/constants";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";
import { WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL } from "@/lib/plans";
import { buildBreadcrumbSchema } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { PlansComparisonTable } from "./PlansComparisonTable";
import { PlansPricingBlock } from "./PlansPricingBlock";

const Footer = dynamic(
  () => import("@/components/landing/Footer").then((m) => ({ default: m.Footer })),
  { loading: () => <LandingSectionSkeleton className="min-h-[100px]" label="A carregar rodapé…" /> },
);

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo.plans" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: "/planos",
      languages: {
        "pt-BR": `${SITE_URL}/planos`,
        en: `${SITE_URL}/en/plans`,
        es: `${SITE_URL}/es/planes`,
        "x-default": `${SITE_URL}/planos`,
      },
    },
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      url: `${SITE_URL}/planos`,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: t("ogImageAlt") }],
    },
  };
}

export default async function PlanosPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo.schemas" });

  const structuredData = [
    buildBreadcrumbSchema([
      { name: t("breadcrumb.home"), path: "/" },
      { name: t("breadcrumb.plans"), path: "/planos" },
    ]),
  ];

  return (
    <>
      {structuredData.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <SalesSiteHeader />
      <main className="bg-surface-base pb-20">
        <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-surface-brown/40 to-surface-base px-4 py-16 sm:px-6 lg:px-8">
          <div className="pointer-events-none absolute left-1/2 top-0 h-[320px] w-[min(100vw,720px)] -translate-x-1/2 rounded-full bg-primary/10 blur-[100px]" />
          <div className="relative mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Vendas · Assinaturas</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-content sm:text-4xl lg:text-5xl">
              Planos pensados para cada fase do seu crescimento
            </h1>
            <p className="mt-4 text-base text-content-muted sm:text-lg">
              Preços em reais, sem surpresas. Escolha o plano, revise no checkout e ative o MyChatCRM com a API oficial
              do WhatsApp.
            </p>
            <p className="mx-auto mt-5 max-w-2xl rounded-2xl border border-primary/25 bg-primary/[0.07] px-4 py-3 text-sm font-medium leading-relaxed text-content sm:text-[15px]">
              Nos planos com <span className="text-content">checkout online</span> (Solo, Equipa e Escala) você dispõe de{" "}
              <span className="text-primary">7 dias</span> para solicitar reembolso se não ficar satisfeito — condições no
              momento da contratação. <span className="text-content-secondary">Enterprise: conforme proposta assinada.</span>
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Link
                href="/#faq"
                className="text-sm font-medium text-content-secondary underline-offset-4 transition hover:text-primary hover:underline"
              >
                Dúvidas frequentes
              </Link>
              <span className="hidden text-content-faint sm:inline" aria-hidden>
                ·
              </span>
              <Link
                href="/login"
                className="text-sm font-medium text-content-secondary underline-offset-4 transition hover:text-primary hover:underline"
              >
                Já sou cliente — entrar
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-2xl font-bold text-content sm:text-3xl">Compare e selecione</h2>
            <div className="title-accent-line" aria-hidden />
            <p className="mt-3 text-sm text-content-muted">
              Ao clicar em um plano você será direcionado ao checkout seguro para concluir a assinatura (demonstração).
            </p>
          </div>
        </section>

        <PlansPricingBlock />

        <PlansComparisonTable />

        <section
          id="especialista"
          className="mx-auto mt-20 max-w-6xl scroll-mt-28 rounded-3xl border border-line bg-surface-card px-6 py-12 sm:px-10 lg:px-16"
        >
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-2xl font-bold text-content">Fale com um especialista</h2>
            <p className="mt-3 text-sm text-content-muted">
              Tire dúvidas sobre limites de leads, integrações, números WhatsApp adicionais (R$ {WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL}/mês cada) ou migração do seu atendimento atual.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <a
                href={whatsappHandoffHref()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-gradient-primary px-6 text-base font-semibold text-white shadow-primary-glow transition hover:shadow-cta-glow"
              >
                Conversar no WhatsApp
              </a>
              <Link
                href="/"
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-primary px-6 text-base font-semibold text-primary transition hover:bg-primary/10"
              >
                Voltar ao site
              </Link>
            </div>
          </div>
        </section>

        <Footer />
      </main>
    </>
  );
}
