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
    <div className="min-h-dvh bg-surface-base lg:flex">
      <div className="flex flex-1 flex-col border-line/40 px-6 py-12 lg:max-w-[min(100%,540px)] lg:border-r lg:bg-surface-deep lg:px-12">
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="mt-10 h-4 w-32" />
        <Skeleton className="mt-3 h-9 w-full max-w-sm" />
        <Skeleton className="mt-2 h-4 w-full max-w-md" />
        <div className="mt-10 space-y-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-full max-w-md rounded-xl" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-11 w-full max-w-md rounded-xl" />
          <Skeleton className="h-12 w-full max-w-md rounded-xl" />
        </div>
      </div>
      <div className="hidden flex-1 bg-surface-brown lg:block" />
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
