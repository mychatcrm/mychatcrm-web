import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MaintenancePublicClient } from "./MaintenancePublicClient";
import { routing } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo.maintenance" });

  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function ManutencaoPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "maintenance" });

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface-base px-4 py-12 pt-safe pb-safe text-center sm:px-6 sm:py-16">
      <div className="ds-public-card mx-auto w-full max-w-md px-6 py-10 sm:px-8 sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{t("brand")}</p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-content sm:text-3xl">
          {t("heading")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-content-muted">{t("body")}</p>
        <MaintenancePublicClient locale={locale} />
        <p className="mt-10 text-xs text-content-faint">
          <Link
            href={`mailto:${t("supportEmail")}`}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-1 underline-offset-2 hover:text-primary hover:underline"
          >
            {t("contactSupport")}
          </Link>
        </p>
      </div>
    </div>
  );
}
