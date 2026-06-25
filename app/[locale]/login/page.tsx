import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import LoginForm from "./LoginForm";
import { Skeleton } from "@/components/ui/Skeleton";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo.login" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: "/login",
      languages: {
        "pt-BR": `${SITE_URL}/login`,
        en: `${SITE_URL}/en/login`,
        es: `${SITE_URL}/es/login`,
        "x-default": `${SITE_URL}/login`,
      },
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: `${SITE_URL}/login`,
      images: ["/og-image.png"],
    },
  };
}

function LoginFallback() {
  return (
    <div className="flex min-h-dvh bg-mc-bg">
      {/* Brand panel placeholder */}
      <div
        className="hidden lg:block lg:w-[420px] xl:w-[480px]"
        style={{ backgroundColor: "var(--color-coal)" }}
        aria-hidden
      />
      {/* Form panel skeleton */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[380px] space-y-4">
          <Skeleton className="h-10 w-full rounded-mc-base" />
          <div className="space-y-3 pt-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-11 w-full rounded-mc-base" />
            <Skeleton className="h-4 w-14 pt-2" />
            <Skeleton className="h-11 w-full rounded-mc-base" />
            <Skeleton className="h-12 w-full rounded-mc-base" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
