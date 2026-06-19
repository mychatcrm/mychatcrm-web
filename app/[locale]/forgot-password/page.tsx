import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { Skeleton } from "@/components/ui/Skeleton";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const path = locale === routing.defaultLocale ? "/forgot-password" : `/${locale}/forgot-password`;
  return {
    title: "Esqueci a palavra-passe | MyChatCRM",
    description: "Recupere o acesso ao painel do cliente MyChatCRM.",
    robots: { index: false, follow: false },
    alternates: { canonical: path },
    openGraph: {
      title: "Esqueci a palavra-passe | MyChatCRM",
      url: `${SITE_URL}${path}`,
    },
  };
}

function ForgotFallback() {
  return (
    <div className="min-h-dvh bg-surface-base px-6 py-12">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="mt-8 h-11 w-full max-w-md" />
    </div>
  );
}

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  const loginHref = locale === routing.defaultLocale ? "/login" : `/${locale}/login`;

  return (
    <Suspense fallback={<ForgotFallback />}>
      <ForgotPasswordForm
        variant="client"
        scope="member"
        title="Recuperar palavra-passe"
        subtitle="Indique o e-mail da sua conta de cliente. Se existir, enviaremos um link seguro para definir uma nova palavra-passe."
        loginHref={loginHref}
        loginLabel="Voltar ao início de sessão"
      />
    </Suspense>
  );
}
