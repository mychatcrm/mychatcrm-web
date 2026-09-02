"use client";

/** Casca escura da confirmação de pagamento. O `CheckoutSuccessView` fica igual. */

import Link from "next/link";
import { McxFooter, McxNav, McxPage } from "@/components/marketing/mcx";

export function McxSuccessShell({ children }: { children: React.ReactNode }) {
  return (
    <McxPage>
      <McxNav compact />

      <main style={{ position: "relative", overflow: "hidden", minHeight: "60dvh" }}>
        <div className="mcx-grid" />
        <div
          className="mcx-aurora"
          style={{
            width: 520,
            height: 520,
            top: -280,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(25,206,114,.16)",
          }}
        />

        <div
          className="mcx-shell"
          style={{
            position: "relative",
            zIndex: 1,
            maxWidth: 780,
            padding: "clamp(32px,5vw,56px) 24px clamp(60px,8vw,100px)",
          }}
        >
          <nav aria-label="Trilha" style={{ marginBottom: 26 }}>
            <ol
              className="mcx-mono"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 9,
                textTransform: "none",
                letterSpacing: ".05em",
              }}
            >
              <li>
                <Link href="/" style={{ color: "var(--faint)", textDecoration: "none" }}>
                  Início
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li>
                <Link href="/planos" style={{ color: "var(--faint)", textDecoration: "none" }}>
                  Planos
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li style={{ color: "var(--live)" }}>Pagamento confirmado</li>
            </ol>
          </nav>

          {children}
        </div>
      </main>

      <McxFooter />
    </McxPage>
  );
}
