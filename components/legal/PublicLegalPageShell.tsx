import Link from "next/link";
import type { ReactNode } from "react";
import { McxFooter, McxNav, McxPage } from "@/components/marketing/mcx";

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
    <McxPage>
      <McxNav compact />

      <main
        className="mcx-shell"
        style={{ maxWidth: 820, padding: "clamp(40px,6vw,72px) 24px clamp(56px,7vw,88px)" }}
      >
        <Link href={homeHref} className="mcx-navlink" style={{ fontSize: ".85rem" }}>
          ← {backHomeLabel}
        </Link>

        <h1 className="mcx-h1" style={{ marginTop: 22, fontSize: "clamp(1.9rem,3.4vw,2.7rem)" }}>
          {title}
        </h1>
        <p className="mcx-mono" style={{ marginTop: 12, textTransform: "none", letterSpacing: ".05em" }}>
          {updatedLabel} {updated}
        </p>

        <div className="mcx-legal">{children}</div>

        {footer ? (
          <div
            className="mcx-mono"
            style={{
              marginTop: 40,
              paddingTop: 22,
              borderTop: "1px solid var(--line)",
              textTransform: "none",
              letterSpacing: ".04em",
              lineHeight: 1.7,
            }}
          >
            {footer}
          </div>
        ) : null}
      </main>

      <McxFooter />
    </McxPage>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mcx-h3" style={{ fontSize: "1.05rem", marginBottom: 10 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export const LEGAL_CONTACT_EMAIL = "mychatcrm@gmail.com";
