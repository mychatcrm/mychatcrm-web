import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { JsonLd } from "@/components/JsonLd";
import {
  buildBreadcrumbSchema,
  buildFaqSchema,
  buildOrganizationSchema,
  buildProductSchema,
  buildSoftwareApplicationSchema,
} from "@/lib/seo";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";
import { LandingV2 } from "@/components/landing/LandingV2";

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo.home" });

  return {
    title: t("title"),
    description: t("description"),
    keywords: t.raw("keywords") as string[],
    alternates: {
      canonical: "/",
      languages: {
        "pt-BR": `${SITE_URL}/`,
        en: `${SITE_URL}/en`,
        es: `${SITE_URL}/es`,
        "x-default": `${SITE_URL}/`,
      },
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: SITE_URL,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: t("ogImageAlt") }],
    },
  };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  const tSeo = await getTranslations({ locale, namespace: "seo.schemas" });

  const structuredData = [
    buildOrganizationSchema(),
    buildSoftwareApplicationSchema(),
    buildProductSchema(),
    buildFaqSchema(),
    buildBreadcrumbSchema([{ name: tSeo("breadcrumb.home"), path: "/" }]),
  ];

  return (
    <>
      {structuredData.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <LandingV2 />
    </>
  );
}
