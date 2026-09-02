"use client";

/**
 * Casca escura do checkout.
 *
 * O `CheckoutView` não é tocado: toda a lógica de cupão, verificação de e-mail
 * e criação da sessão Stripe continua igual. O tema chega por herança — dentro
 * de `.mcx` os tokens de superfície e texto do Tailwind apontam para a paleta
 * escura, então os componentes partilhados (Input, Button) acompanham sozinhos.
 */

import Link from "next/link";
import { Lock, ShieldCheck } from "lucide-react";
import { McxFooter, McxNav, McxPage } from "@/components/marketing/mcx";

export function McxCheckoutShell({
  planName,
  annual,
  children,
}: {
  planName: string;
  annual: boolean;
  children: React.ReactNode;
}) {
  return (
    <McxPage>
      <McxNav compact />

      <main style={{ position: "relative", overflow: "hidden" }}>
        <div className="mcx-grid" />
        <div
          className="mcx-aurora"
          style={{
            width: 560,
            height: 560,
            top: -300,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(242,68,0,.16)",
          }}
        />

        <div
          className="mcx-shell"
          style={{
            position: "relative",
            zIndex: 1,
            padding: "clamp(32px,5vw,56px) 24px clamp(60px,8vw,100px)",
            maxWidth: 1120,
          }}
        >
          <nav aria-label="Trilha" style={{ marginBottom: 22 }}>
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
              <li style={{ color: "var(--brand-hi)" }}>Checkout · {planName}</li>
            </ol>
          </nav>

          <span className="mcx-chip" style={{ marginBottom: 18 }}>
            <Lock size={12} style={{ color: "var(--live)" }} />
            Pagamento seguro via Stripe
          </span>

          <h1 className="mcx-h1" style={{ fontSize: "clamp(2rem,4vw,3rem)" }}>
            Falta pouco para ativar.
          </h1>

          <p className="mcx-lead" style={{ marginTop: 16 }}>
            Você está assinando o plano <strong style={{ color: "var(--text)" }}>{planName}</strong>
            {annual ? (
              <>
                {" "}
                no <strong style={{ color: "var(--text)" }}>ciclo anual</strong> — 12 meses, com o
                bruto, o desconto e o valor a pagar detalhados no resumo
              </>
            ) : null}
            . Preencha seus dados e siga para o pagamento.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px 20px",
              marginTop: 20,
              alignItems: "center",
            }}
          >
            <span
              className="mcx-mono"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                textTransform: "none",
                letterSpacing: ".04em",
              }}
            >
              <ShieldCheck size={13} style={{ color: "var(--live)" }} />7 dias para pedir reembolso
            </span>
            <span
              className="mcx-mono"
              style={{ textTransform: "none", letterSpacing: ".04em" }}
            >
              Cartão processado pela Stripe — não passa pelos nossos servidores
            </span>
          </div>

          <div style={{ marginTop: 40 }}>{children}</div>
        </div>
      </main>

      <McxFooter />
    </McxPage>
  );
}
