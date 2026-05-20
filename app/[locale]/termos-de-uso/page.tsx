import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LocalizedTermsPage } from "@/components/legal/LocalizedTermsPage";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";
import { localizedLegalTermsHref } from "@/lib/legal-routes";
import type { Locale } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales
    .filter((locale) => locale !== "pt-BR")
    .map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  const href = localizedLegalTermsHref(locale as Locale);

  return {
    title: t("termsPage.metaTitle"),
    description: t("termsPage.metaDescription"),
    alternates: {
      canonical: href,
      languages: {
        "pt-BR": `${SITE_URL}/termos-de-uso`,
        en: `${SITE_URL}/en/terms-of-use`,
        es: `${SITE_URL}/es/terminos-de-uso`,
        "x-default": `${SITE_URL}/termos-de-uso`,
      },
    },
    openGraph: {
      title: t("termsPage.metaTitle"),
      url: `${SITE_URL}${href}`,
    },
  };
}

export default async function TermosDeUsoLocalizedPage(_props: Props) {
  return <LocalizedTermsPage />;
}
