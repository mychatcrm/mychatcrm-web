import type { Metadata } from "next";
import Link from "next/link";
import { MaintenancePublicClient } from "./MaintenancePublicClient";

export const metadata: Metadata = {
  title: "Manutenção | MyChatCRM",
  description: "O MyChatCRM está temporariamente indisponível.",
  robots: { index: false, follow: false },
};

export default function ManutencaoPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface-base px-4 py-12 pt-safe pb-safe text-center sm:px-6 sm:py-16">
      <div className="ds-public-card mx-auto w-full max-w-md px-6 py-10 sm:px-8 sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">MyChatCRM</p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-content sm:text-3xl">
          Estamos em manutenção
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-content-muted">
          O serviço está temporariamente indisponível. Tente novamente dentro de instantes.
        </p>
        <MaintenancePublicClient />
        <p className="mt-10 text-xs text-content-faint">
          <Link
            href="mailto:suporte@mychatcrm.com.br"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-1 underline-offset-2 hover:text-primary hover:underline"
          >
            Contactar suporte
          </Link>
        </p>
      </div>
    </div>
  );
}
