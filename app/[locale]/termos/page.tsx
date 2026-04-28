import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo.terms" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: "/termos",
      languages: {
        "pt-BR": `${SITE_URL}/termos`,
        en: `${SITE_URL}/en/terms`,
        es: `${SITE_URL}/es/terminos`,
        "x-default": `${SITE_URL}/termos`,
      },
    },
  };
}

export default async function TermosPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.terms" });
  const tCommon = await getTranslations({ locale, namespace: "common.buttons" });

  return (
    <div className="min-h-screen bg-surface-base mx-auto max-w-3xl px-4 py-16 text-content">
      <Link href="/" className="text-sm text-primary hover:underline">
        ← {tCommon("back")}
      </Link>
      <h1 className="mt-6 font-display text-3xl font-bold">{t("heading")}</h1>
      <p className="mt-3 text-sm text-content-secondary">{t("placeholder")}</p>
    </div>
  );
}
