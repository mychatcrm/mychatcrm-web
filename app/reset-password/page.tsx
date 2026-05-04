import type { Metadata } from "next";
import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";
import { Skeleton } from "@/components/ui/Skeleton";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Redefinir palavra-passe | MyChatCRM",
  description: "Defina uma nova palavra-passe para a sua conta MyChatCRM.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/reset-password" },
  openGraph: {
    title: "Redefinir palavra-passe | MyChatCRM",
    url: `${SITE_URL}/reset-password`,
  },
};

function ResetFallback() {
  return (
    <div className="min-h-dvh bg-surface-base px-6 py-12">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="mt-8 h-11 w-full max-w-md" />
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
