import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "./LoginForm";
import { Skeleton } from "@/components/ui/Skeleton";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Entrar | MyChatCRM",
  description:
    "Acesse sua conta MyChatCRM para gerenciar chatbot, CRM Kanban, agenda, integrações e suporte.",
  alternates: { canonical: "/login" },
  openGraph: {
    title: "Entrar | MyChatCRM",
    description:
      "Acesse sua conta MyChatCRM para gerenciar chatbot, CRM Kanban, agenda, integrações e suporte.",
    url: `${SITE_URL}/login`,
    images: ["/og-image.png"],
  },
};

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
