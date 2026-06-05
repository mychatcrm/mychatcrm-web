import Link from "next/link";
import type { ReactNode } from "react";

export function PublicLegalPageShell({
  title,
  updated,
  children,
  footer,
  backHomeLabel = "Voltar ao início",
  updatedLabel = "Última atualização:",
  homeHref = "/",
}: {
  title: string;
  updated: string;
  children: ReactNode;
  footer?: ReactNode;
  backHomeLabel?: string;
  updatedLabel?: string;
  homeHref?: string;
}) {
  return (
    <div className="min-h-screen bg-surface-base text-content">
      <header className="border-b border-line/80 bg-surface-deep/90">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <Link href={homeHref} className="font-display text-lg font-semibold tracking-tight text-primary hover:text-primary-hover">
            MyChatCRM
          </Link>
          <Link href={homeHref} className="text-sm text-content-muted transition hover:text-content">
            {backHomeLabel}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-display text-3xl font-bold text-content sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-content-muted">
          {updatedLabel} {updated}
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-content-secondary">{children}</div>

        {footer ? <div className="mt-10 border-t border-line pt-6 text-xs text-content-faint">{footer}</div> : null}
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold text-content">{title}</h2>
      {children}
    </section>
  );
}

export const LEGAL_CONTACT_EMAIL = "mychatcrm@gmail.com";
