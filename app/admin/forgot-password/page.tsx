import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { Skeleton } from "@/components/ui/Skeleton";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Recuperar acesso — Admin | MyChatCRM",
  description: "Recuperação de palavra-passe do painel administrativo.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/admin/forgot-password" },
  openGraph: {
    title: "Recuperar acesso — Admin | MyChatCRM",
    url: `${SITE_URL}/admin/forgot-password`,
  },
};

function ForgotFallback() {
  return (
    <div className="min-h-dvh bg-surface-base px-6 py-12">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="mt-8 h-11 w-full max-w-md" />
    </div>
  );
}

export default function AdminForgotPasswordPage() {
  return (
    <Suspense fallback={<ForgotFallback />}>
      <ForgotPasswordForm
        variant="admin"
        scope="admin"
        title="Recuperar acesso administrativo"
        subtitle="Indique o e-mail da sua conta de administrador. Se existir, receberá um link seguro para definir uma nova palavra-passe."
        loginHref="/admin/login"
        loginLabel="Voltar ao login admin"
      />
    </Suspense>
  );
}
