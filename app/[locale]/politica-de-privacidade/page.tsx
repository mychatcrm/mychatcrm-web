import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LocalizedPrivacyPolicyPage } from "@/components/legal/LocalizedPrivacyPolicyPage";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";
import { localizedLegalPrivacyHref } from "@/lib/legal-routes";
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
  const href = localizedLegalPrivacyHref(locale as Locale);

  return {
    title: t("privacyPage.metaTitle"),
    description: t("privacyPage.metaDescription"),
    alternates: {
      canonical: href,
      languages: {
        "pt-BR": `${SITE_URL}/politica-de-privacidade`,
        en: `${SITE_URL}/en/privacy-policy`,
        es: `${SITE_URL}/es/politica-de-privacidad`,
        "x-default": `${SITE_URL}/politica-de-privacidade`,
      },
    },
    openGraph: {
      title: t("privacyPage.metaTitle"),
      url: `${SITE_URL}${href}`,
    },
  };
}

export default async function PoliticaDePrivacidadeLocalizedPage(_props: Props) {
  return <LocalizedPrivacyPolicyPage />;
}
