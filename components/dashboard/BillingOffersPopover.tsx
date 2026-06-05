"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/Badge";
import type { ClientSession } from "@/lib/client-auth";
import { SALES_PLANS, WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL, type SalesPlan } from "@/lib/plans";
import { normalizeClientPlan } from "@/lib/plan-limits";
import { cn, formatBRL } from "@/lib/utils";
import { typography } from "@/lib/typography";

const whatsappExtraLine = `Números WhatsApp: 1 incluído em todos os planos; cada número extra ${formatBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês.`;

function planAccentClass(plan: SalesPlan) {
  if (plan.accent === "popular") {
    return "border-2 border-primary/60 bg-surface-card";
  }
  if (plan.accent === "enterprise") {
    return "border border-primary/35 bg-surface-deep";
  }
  return "border border-line bg-surface-deep/25 hover:border-primary/30";
}

function clientPlanToSlug(plan: ClientSession["plan"]): string {
  return normalizeClientPlan(plan);
}

type AnchorBox = { left: number; top: number; width: number; height: number };

export function BillingOffersPopover({
  mode,
  session,
  plansTriggerRef,
  extraLeadsTriggerRef,
  onClose,
}: {
  mode: "plans" | "extraLeads" | null;
  session: ClientSession;
  plansTriggerRef: RefObject<HTMLButtonElement | null>;
  extraLeadsTriggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [box, setBox] = useState<AnchorBox | null>(null);

  const refreshPosition = useCallback(() => {
    if (!mode) {
      setBox(null);
      return;
    }
    const el = mode === "plans" ? plansTriggerRef.current : extraLeadsTriggerRef.current;
    if (!el) {
      setBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setBox({ left: r.left, top: r.top, width: r.width, height: r.height });
  }, [mode, plansTriggerRef, extraLeadsTriggerRef]);

  useLayoutEffect(() => {
    if (!mode) {
      setBox(null);
      return;
    }
    refreshPosition();
    const onScroll = () => refreshPosition();
    const onResize = () => refreshPosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [mode, refreshPosition]);

  useEffect(() => {
    if (!mode) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (plansTriggerRef.current?.contains(t)) return;
      if (extraLeadsTriggerRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [mode, onClose, plansTriggerRef, extraLeadsTriggerRef]);

  if (!mode || typeof document === "undefined" || !box) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popW = Math.min(440, vw - 24);
  const centerX = box.left + box.width / 2;
  const left = Math.max(12, Math.min(centerX - popW / 2, vw - 12 - popW));
  const maxH = Math.min(580, vh - 24);
  let top = box.top + box.height + 10;
  if (top + maxH > vh - 12) {
    top = Math.max(12, box.top - 10 - Math.min(maxH, vh * 0.62));
  }

  const currentSlug = clientPlanToSlug(session.plan);

  const footLink = (href: string, className: string, children: ReactNode) => (
    <Link href={href} className={className} onClick={() => onClose()}>
      {children}
    </Link>
  );

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed z-[140] overflow-hidden rounded-xl border border-line bg-surface-card text-content"
      style={{ left, top, width: popW, maxHeight: maxH }}
    >
      <div className="max-h-[inherit] overflow-y-auto overscroll-contain">
        {mode === "plans" ? (
          <div className="p-4">
            <div className="mb-0.5 flex items-center gap-1.5">
              <div className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
              <p id={titleId} className={cn(typography.ui.overline, "text-primary")}>Planos comerciais</p>
            </div>
            <h2 className={cn("mt-0.5", typography.heading.h5)}>Alterar plano de assinatura</h2>
            <p className="mt-2 text-xs leading-relaxed text-content-muted">
              Planos Solo, Equipa e Escala com limite mensal de <strong className="font-medium text-content">leads atendidos</strong> (checkout de demonstração).
              A opção <strong className="font-medium text-content">Enterprise</strong> é sob consulta — pacote e tetos definidos em contrato, sem listagem fixa
              neste painel.
            </p>
            <ul className="mt-4 space-y-2.5">
              {SALES_PLANS.map((plan) => {
                const isCurrent = plan.slug === currentSlug;
                const priceMonthly = plan.priceMonthly;
                const hasCheckout = priceMonthly != null && !plan.contactOnly;
                const href = hasCheckout ? `/checkout/${plan.slug}` : "/planos#especialista";
                return (
                  <li key={plan.slug}>
                    <Link
                      href={href}
                      onClick={() => onClose()}
                      className={cn(
                        "block rounded-xl p-3.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card",
                        planAccentClass(plan),
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-display text-base font-semibold text-content">{plan.name}</span>
                            {isCurrent ? (
                              <Badge className="border-transparent bg-primary/20 text-[10px] font-semibold text-primary">Plano atual</Badge>
                            ) : plan.badge ? (
                              <Badge className="border-transparent bg-primary/15 text-[10px] font-semibold text-primary">{plan.badge}</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11px] leading-snug text-content-muted">{plan.tagline}</p>
                          <p className="mt-2 text-xs text-content-secondary">
                            {plan.contactOnly
                              ? "Proposta comercial sob medida — sem detalhe de pacote fixo aqui."
                              : `${plan.monthlyLeadsLabel} · ${plan.whatsappNumbers}`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {hasCheckout ? (
                            <>
                              <p className="font-display text-lg font-bold tabular-nums text-content">{formatBRL(priceMonthly)}</p>
                              <p className="text-[10px] font-medium text-content-faint">/mês</p>
                            </>
                          ) : (
                            <p className="font-display text-lg font-bold tabular-nums text-content">Sob consulta</p>
                          )}
                        </div>
                      </div>
                      <span className="mt-3 flex min-h-[40px] w-full items-center justify-center rounded-xl bg-primary text-center text-sm font-medium text-white">
                        {hasCheckout ? "Continuar para pagamento" : "Agendar reunião comercial"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 border-t border-line/80 pt-3">
              {footLink(
                "/planos",
                "text-xs font-semibold text-primary underline-offset-4 transition hover:underline",
                "Ver comparativo completo na página de planos",
              )}
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="mb-0.5 flex items-center gap-1.5">
              <div className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
              <p id={titleId} className={cn(typography.ui.overline, "text-primary")}>Mais leads no ciclo</p>
            </div>
            <h2 className={cn("mt-0.5", typography.heading.h5)}>Aumentar o limite mensal</h2>
            <p className="mt-2 text-xs leading-relaxed text-content-muted">
              A cobrança é por <strong className="font-medium text-content">quantidade de leads atendidos por mês</strong> (contagem distinta no ciclo). Para
              mais volume, faça upgrade para um plano superior ou negocie um pacote Enterprise com o comercial.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-content-muted">{whatsappExtraLine}</p>
            <ul className="mt-4 space-y-2 text-sm text-content-secondary">
              <li className="rounded-xl border border-line/70 bg-surface-deep/25 px-3 py-2">
                <span className="font-semibold text-content">Solo</span> — 500 leads/mês
              </li>
              <li className="rounded-xl border border-line/70 bg-surface-deep/25 px-3 py-2">
                <span className="font-semibold text-content">Equipa</span> — 5.000 leads/mês
              </li>
              <li className="rounded-xl border border-line/70 bg-surface-deep/25 px-3 py-2">
                <span className="font-semibold text-content">Escala</span> — 15.000 leads/mês
              </li>
            </ul>
            <div className="mt-4 flex flex-col gap-2">
              {footLink(
                "/planos",
                "flex min-h-[44px] items-center justify-center rounded-xl bg-primary text-center text-sm font-medium text-white transition hover:bg-primary-hover",
                "Ver planos e checkout",
              )}
              {footLink(
                "/planos#especialista",
                "flex min-h-[44px] items-center justify-center rounded-xl border-2 border-primary px-4 text-center text-sm font-medium text-primary transition hover:bg-primary/10",
                "Falar com especialista",
              )}
            </div>
            <div className="mt-4 border-t border-line/70 pt-3">
              {footLink(
                "/planos#comparativo-planos",
                "text-xs font-semibold text-primary underline-offset-4 transition hover:underline",
                "Ver tabela comparativa na página de planos",
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
