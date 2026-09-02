"use client";

/**
 * Casca dos ecrãs de acesso: login admin, recuperação de palavra-passe
 * (cliente e admin) e definição de nova palavra-passe.
 *
 * Mesma identidade das páginas públicas — o tema chega por `McxPage`, onde os
 * tokens de superfície e texto do Tailwind já apontam para a paleta escura.
 * Os formulários que vivem dentro deste layout não foram tocados.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { LogoMark, McxPage } from "@/components/marketing/mcx";

export type AuthSplitVariant = "client" | "admin";

type HeaderAction = { href: string; label: string };

type AuthSplitLayoutProps = {
  variant: AuthSplitVariant;
  eyebrow: string;
  title: string;
  subtitle: string;
  headerAction: HeaderAction;
  children: ReactNode;
};

/** Só afirmações verificáveis — ver a nota em `app/[locale]/login/LoginForm.tsx`. */
const CLIENT_POINTS = [
  "Atende no WhatsApp pela API Oficial da Meta",
  "CRM Kanban, agenda e follow-up no mesmo painel",
  "O agente decide a cada mensagem — não segue roteiro fixo",
] as const;

const ADMIN_POINTS = [
  "Acesso restrito à equipa MyChatCRM",
  "Cada sessão é registada na auditoria operacional",
  "Permissões por papel: financeiro, suporte, marketing, desenvolvedor",
] as const;

function HeroPanel({ variant }: { variant: AuthSplitVariant }) {
  const admin = variant === "admin";
  const points = admin ? ADMIN_POINTS : CLIENT_POINTS;

  return (
    <aside
      className="relative hidden min-h-dvh flex-1 overflow-hidden lg:flex"
      style={{
        borderLeft: "1px solid var(--line)",
        background: admin
          ? "linear-gradient(200deg,rgba(14,29,41,.9),rgba(5,8,11,.4))"
          : "linear-gradient(200deg,rgba(14,29,41,.7),rgba(5,8,11,.25))",
      }}
    >
      <div className="mcx-grid" />
      <div
        className="mcx-aurora"
        style={{
          width: 460,
          height: 460,
          top: -170,
          right: -140,
          background: admin ? "rgba(30,74,110,.4)" : "rgba(242,68,0,.2)",
        }}
      />

      <div
        className="relative z-10 flex w-full flex-col justify-center px-10 py-16 xl:px-16"
        style={{ gap: 28 }}
      >
        <span className="mcx-chip">
          <span className="mcx-dot" />
          {admin ? "Área administrativa" : "O comercial que não dorme"}
        </span>

        <h2 className="mcx-h2" style={{ fontSize: "clamp(1.7rem,2.3vw,2.3rem)", maxWidth: "16ch" }}>
          {admin ? (
            <>
              Painel de controle da plataforma.
            </>
          ) : (
            <>
              Sua operação atende sozinha, inclusive de madrugada.
            </>
          )}
        </h2>

        <ul className="mcx-auth-points" style={{ maxWidth: 420 }}>
          {points.map((point) => (
            <li key={point}>
              <Check size={14} strokeWidth={3} />
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            borderTop: "1px solid var(--line)",
            paddingTop: 22,
            maxWidth: 420,
          }}
        >
          <ShieldCheck size={14} style={{ color: "var(--live)" }} />
          <span className="mcx-mono" style={{ textTransform: "none", letterSpacing: ".04em" }}>
            {admin
              ? "Sessões protegidas e auditadas"
              : "7 dias para pedir reembolso nos planos com checkout online"}
          </span>
        </div>
      </div>
    </aside>
  );
}

export function AuthSplitLayout({
  variant,
  eyebrow,
  title,
  subtitle,
  headerAction,
  children,
}: AuthSplitLayoutProps) {
  const admin = variant === "admin";

  return (
    <McxPage>
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <section
          className="relative flex flex-1 flex-col justify-center px-4 py-10 sm:px-8 lg:max-w-[min(100%,560px)] lg:flex-none lg:px-12 xl:px-16"
          style={{ background: "var(--ground)" }}
        >
          <div className="absolute right-4 top-4 sm:right-6 sm:top-6 lg:right-8 lg:top-8">
            <Link
              href={headerAction.href}
              className="mcx-btn mcx-btn-ghost"
              style={{ padding: "9px 16px", fontSize: ".8rem" }}
            >
              {headerAction.label}
            </Link>
          </div>

          <div className="mx-auto mt-10 w-full max-w-md lg:mt-0">
            <Link
              href="/"
              style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}
              aria-label="MyChatCRM — página inicial"
            >
              <LogoMark size={32} />
              <span className="mcx-wordmark">MyChatCRM</span>
              {admin ? (
                <span
                  className="mcx-mono"
                  style={{
                    border: "1px solid var(--line-strong)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 9,
                    color: "var(--brand-hi)",
                  }}
                >
                  Admin
                </span>
              ) : null}
            </Link>

            <p
              className="mcx-mono"
              style={{ marginTop: 38, color: "var(--brand)", letterSpacing: ".2em" }}
            >
              {eyebrow}
            </p>
            <h1 className="mcx-h1" style={{ marginTop: 10, fontSize: "clamp(1.7rem,3vw,2.2rem)" }}>
              {title}
            </h1>
            <p className="mcx-body" style={{ marginTop: 12, maxWidth: "46ch" }}>
              {subtitle}
            </p>

            <div className="mt-8">{children}</div>

            <div
              className="mcx-card lg:hidden"
              style={{ marginTop: 36, padding: 18 }}
              aria-hidden
            >
              <p className="mcx-h3" style={{ fontSize: ".95rem" }}>
                CRM Kanban + IA no WhatsApp
              </p>
              <p className="mcx-body" style={{ marginTop: 6, fontSize: ".82rem" }}>
                Painel completo depois de entrar — o mesmo fluxo no computador e no telemóvel.
              </p>
            </div>

            <div
              style={{
                marginTop: 36,
                paddingTop: 22,
                borderTop: "1px solid var(--line)",
                display: "flex",
                flexWrap: "wrap",
                gap: "8px 20px",
              }}
            >
              <Link href="/termos-de-uso" className="mcx-navlink" style={{ fontSize: ".8rem" }}>
                Termos de uso
              </Link>
              <Link
                href="/politica-de-privacidade"
                className="mcx-navlink"
                style={{ fontSize: ".8rem" }}
              >
                Política de privacidade
              </Link>
            </div>
          </div>
        </section>

        <HeroPanel variant={variant} />
      </div>
    </McxPage>
  );
}
