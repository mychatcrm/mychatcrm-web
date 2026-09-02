import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL } from "@/lib/constants";
import { buildBreadcrumbSchema } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { PlanosView } from "./PlanosView";

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
      <Suspense fallback={null}>
        <PlanosView />
      </Suspense>
    </>
  );
}
