"use client";

import Image from "next/image";
import { BRAND_LOGO } from "@/lib/brand";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

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

function HeroPanel({ variant }: { variant: AuthSplitVariant }) {
  const reducedMotion = useReducedMotion();

  return (
    <aside
      className="relative hidden min-h-dvh flex-1 overflow-hidden lg:flex"
      aria-hidden
    >
      <div
        className={
          variant === "admin"
            ? "absolute inset-0 bg-surface-deep"
            : "absolute inset-0 bg-surface-base"
        }
      />
      <div className="pointer-events-none absolute inset-0 border-l border-line/80" />
      <div className="relative z-10 flex w-full flex-col justify-center px-10 py-16 xl:px-16">
        <p className="max-w-md font-display text-2xl font-semibold leading-snug text-content xl:text-3xl">
          Atenda, venda e organize com{" "}
          <span className="text-primary">IA no WhatsApp</span>.
        </p>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-content-muted">
          CRM Kanban e Agenda integrados — treinamento com especialistas para o seu segmento.
        </p>

        <div className="relative mt-14 h-[min(52vh,420px)] w-full max-w-lg">
          <motion.div
            className="absolute left-0 top-0 w-[58%] rounded-2xl border border-line/80 bg-surface-card p-4"
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : 0.1 }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">
              Pipeline
            </p>
            <div className="mt-3 flex gap-1.5">
              {["Novo", "Contato", "Proposta"].map((c) => (
                <span
                  key={c}
                  className="rounded-md bg-surface-elevated/80 px-2 py-1 text-[10px] text-content-secondary"
                >
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-2 rounded-full bg-primary/70"
                  style={{ width: `${78 - i * 12}%` }}
                />
              ))}
            </div>
          </motion.div>

          <motion.div
            className="absolute right-0 top-[12%] w-[48%] rounded-2xl border border-primary/25 bg-surface-deep p-4"
            initial={reducedMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : 0.2 }}
          >
            <div className="flex items-end gap-1.5 pt-2">
              {[40, 65, 45, 80, 55, 90, 48].map((h, i) => (
                <div
                  key={i}
                  className="w-2.5 rounded-sm bg-primary"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
            <p className="mt-3 text-[10px] text-content-muted">Conversas · 30 dias</p>
          </motion.div>

          <motion.div
            className="absolute bottom-[6%] left-[8%] w-[54%] rounded-2xl border border-line/80 bg-surface-card p-4"
            initial={reducedMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : 0.28 }}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                IA
              </span>
              <div className="space-y-1.5">
                <div className="h-2 w-[88%] rounded-full bg-surface-elevated" />
                <div className="h-2 w-[72%] rounded-full bg-surface-elevated/80" />
                <div className="h-2 w-[56%] rounded-full bg-primary/40" />
              </div>
            </div>
          </motion.div>

          <motion.div
            className="absolute bottom-[18%] right-[4%] flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"
            animate={reducedMotion ? false : { y: [0, -6, 0] }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: 4, repeat: Infinity, ease: "easeInOut" }
            }
            aria-hidden
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="opacity-95">
              <path
                d="M12 3C7 3 3 6.5 3 11c0 2 .8 3.8 2.2 5.2L3 21l5-2.2C9.2 19.8 10.5 20 12 20c5 0 9-3.5 9-8s-4-9-9-9z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </motion.div>
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
    <div className="min-h-dvh bg-surface-base pb-safe font-sans text-content">
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <section className="relative flex flex-1 flex-col justify-center border-line/40 px-4 py-10 sm:px-8 lg:max-w-[min(100%,540px)] lg:flex-none lg:border-r lg:bg-surface-deep lg:px-12 xl:px-16">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/35 lg:hidden" />

          <div className="absolute right-4 top-4 sm:right-6 sm:top-6 lg:right-8 lg:top-8">
            <Link
              href={headerAction.href}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-line px-4 text-xs font-semibold uppercase tracking-wide text-content-secondary transition hover:border-primary hover:text-primary"
            >
              {headerAction.label}
            </Link>
          </div>

          <div className="mx-auto mt-10 w-full max-w-md lg:mt-0">
            <Link
              href="/"
              className="inline-flex max-w-full items-start gap-3 rounded-xl outline-none ring-offset-2 ring-offset-surface-deep transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="MyChatCRM — página inicial"
            >
              <Image src={BRAND_LOGO.default} alt="Logotipo MyChatCRM" width={40} height={40} priority className="shrink-0" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2 font-display text-lg font-bold tracking-tight">
                  <span>
                    <span className="text-primary">My</span>
                    <span className="text-content">Chat</span>
                    <span className="text-content">CRM</span>
                  </span>
                  {admin ? (
                    <span className="rounded-md border border-line bg-surface-card/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-content-muted">
                      Admin
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>

            <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              {eyebrow}
            </p>
            <h1 className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight sm:text-[1.65rem] md:text-3xl">
              {title}
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-content-muted">{subtitle}</p>

            <div className="mt-8">{children}</div>

            <div
              className="relative mt-10 overflow-hidden rounded-2xl border border-line/80 bg-surface-card p-5 lg:hidden"
              aria-hidden
            >
              <p className="relative font-display text-sm font-semibold tracking-tight text-content">
                CRM Kanban + <span className="text-primary">IA</span> no WhatsApp
              </p>
              <p className="relative mt-1.5 text-xs leading-relaxed text-content-muted">
                Painel completo após o login — mesmo fluxo no desktop e no celular.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-line/60 pt-6 text-xs text-content-muted">
              <Link href="/termos" className="transition hover:text-primary">
                Termos de Uso
              </Link>
              <Link href="/privacidade" className="transition hover:text-primary">
                Política de Privacidade
              </Link>
            </div>
          </div>
        </section>

        <HeroPanel variant={variant} />
      </div>
    </div>
  );
}
