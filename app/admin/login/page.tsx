import type { Metadata } from "next";
import { Suspense } from "react";
import AdminLoginForm from "./AdminLoginForm";
import { Skeleton } from "@/components/ui/Skeleton";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Entrar — Admin | MyChatCRM",
  description: "Acesso restrito ao painel administrativo MyChatCRM.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/admin/login" },
  openGraph: {
    title: "Entrar — Admin | MyChatCRM",
    description: "Acesso restrito ao painel administrativo MyChatCRM.",
    url: `${SITE_URL}/admin/login`,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "MyChatCRM — Admin" }],
  },
};

function AdminLoginFallback() {
  return (
    <div className="min-h-dvh bg-surface-base lg:flex">
      <div className="flex flex-1 flex-col border-line/40 px-6 py-12 lg:max-w-[min(100%,540px)] lg:border-r lg:bg-surface-deep lg:px-12">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="mt-10 h-4 w-28" />
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

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<AdminLoginFallback />}>
      <AdminLoginForm />
    </Suspense>
  );
}
