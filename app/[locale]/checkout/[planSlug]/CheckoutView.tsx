"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { normalizeCouponCode } from "@/lib/commercial/engine";
import type { CouponRejectCode, CouponValidateResult } from "@/lib/commercial/types";
import {
  PLAN_ANNUAL_DISCOUNT_PERCENT,
  planAnnualCheckoutTotalsBRL,
  planEffectiveMonthlyBRL,
  WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL,
  type PlanBillingCycle,
} from "@/lib/plans";
import { formatBRL } from "@/lib/utils";

export type CheckoutPlanSummary = {
  slug: string;
  name: string;
  priceMonthly: number;
  tagline: string;
  billingCycle: PlanBillingCycle;
};

function centsToBRL(cents: number) {
  return formatBRL(cents / 100);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEBOUNCE_MS = 400;

type EmailStatus = "idle" | "checking" | "available" | "taken" | "uncertain";

export function CheckoutView({ plan }: { plan: CheckoutPlanSummary }) {
  const baseMonthlyBrl = planEffectiveMonthlyBRL(plan.priceMonthly, plan.billingCycle);
  const annualTotals =
    plan.billingCycle === "annual" ? planAnnualCheckoutTotalsBRL(plan.priceMonthly) : null;

  const [loading, setLoading] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [applied, setApplied] = useState<Extract<CouponValidateResult, { ok: true }> | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // --- Estado de verificação de e-mail ---
  const [emailValue, setEmailValue] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Evita dois pedidos em voo com o mesmo e-mail (corrida debounce + blur). */
  const inFlightRef = useRef<string | null>(null);
  /** Último e-mail com resposta definitiva do servidor (para resetar UI ao editar). */
  const lastCompletedRef = useRef<string>("");

  const checkEmail = useCallback(async (email: string) => {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalized)) {
      setEmailStatus("idle");
      return;
    }
    if (inFlightRef.current === normalized) return;

    inFlightRef.current = normalized;
    setEmailStatus("checking");

    try {
      const res = await fetch("/api/checkout/email-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      const data = (await res.json()) as {
        available?: boolean;
        uncertain?: boolean;
        code?: string;
      };

      if (res.status === 429) {
        setEmailStatus("idle");
        inFlightRef.current = null;
        return;
      }

      if (!res.ok) {
        setEmailStatus("uncertain");
        inFlightRef.current = null;
        return;
      }

      if (data.uncertain && data.available === true) {
        setEmailStatus("uncertain");
        lastCompletedRef.current = normalized;
      } else if (data.available === false) {
        setEmailStatus("taken");
        lastCompletedRef.current = normalized;
      } else if (data.available === true) {
        setEmailStatus("available");
        lastCompletedRef.current = normalized;
      } else {
        setEmailStatus("uncertain");
        lastCompletedRef.current = normalized;
      }
    } catch {
      setEmailStatus("uncertain");
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  // Debounce ao digitar (sem depender de emailStatus — evita re-agendar ao mudar checking/error)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = emailValue.trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || !EMAIL_REGEX.test(lower)) {
      setEmailStatus("idle");
      lastCompletedRef.current = "";
      return;
    }

    debounceRef.current = setTimeout(() => {
      void checkEmail(trimmed);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [emailValue, checkEmail]);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmailValue(val);
    setSubmitError(null);
    const norm = val.trim().toLowerCase();
    if (lastCompletedRef.current && norm !== lastCompletedRef.current) {
      setEmailStatus("idle");
      lastCompletedRef.current = "";
    }
  };

  const handleEmailBlur = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void checkEmail(emailValue);
  };

  // Só bloqueia pagamento quando o servidor confirmou que o e-mail já existe.
  // "uncertain" / "available" / "idle" / "checking" permitem tentar (validação final na rota Stripe).
  const emailBlocked = emailStatus === "taken";
  const emailNorm = emailValue.trim().toLowerCase();
  const canSubmit = !loading && !emailBlocked && EMAIL_REGEX.test(emailNorm);

  const applyCoupon = useCallback(async () => {
    if (!normalizeCouponCode(couponInput)) {
      setApplied(null);
      setCouponMessage(null);
      return;
    }
    setCouponLoading(true);
    setCouponMessage(null);
    try {
      const res = await fetch("/api/checkout/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponInput,
          planSlug: plan.slug,
          email: emailValue.trim() || undefined,
          ciclo: plan.billingCycle === "annual" ? "anual" : "mensal",
        }),
      });
      const data = (await res.json().catch(() => null)) as CouponValidateResult | { message?: string } | null;
      if (!data || typeof data !== "object") {
        setApplied(null);
        setCouponMessage("Resposta inválida do servidor.");
        return;
      }
      if (!("ok" in data) || !data.ok) {
        setApplied(null);
        const code = "code" in data ? (data.code as CouponRejectCode | undefined) : undefined;
        if (code === "COUPON_EMPTY") {
          setCouponMessage(null);
          return;
        }
        setCouponMessage("message" in data && data.message ? data.message : "Cupom não pôde ser aplicado.");
        return;
      }
      setApplied(data);
      setCouponMessage(data.message);
    } catch {
      setApplied(null);
      setCouponMessage("Falha de rede. Tente novamente.");
    } finally {
      setCouponLoading(false);
    }
  }, [couponInput, plan.slug, plan.billingCycle, emailValue]);

  const clearCoupon = () => {
    setApplied(null);
    setCouponMessage(null);
    setCouponInput("");
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);

    if (emailBlocked) return;

    setLoading(true);

    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "").trim();
    const name = String(fd.get("fullName") ?? "").trim();
    const company = String(fd.get("company") ?? "").trim();

    try {
      if (applied) {
        const couponRes = await fetch("/api/checkout/coupon/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: applied.code,
            planSlug: plan.slug,
            email,
            ciclo: plan.billingCycle === "annual" ? "anual" : "mensal",
            idempotencyKey:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `idem-${Date.now()}`,
          }),
        });
        if (!couponRes.ok) {
          const data = await couponRes.json().catch(() => null);
          setSubmitError((data as { message?: string } | null)?.message ?? "Não foi possível confirmar o cupom.");
          return;
        }
      }

      console.log(
        "[CHECKOUT DEBUG] payload enviado ao backend:",
        JSON.stringify({
          planSlug: plan.slug,
          ciclo: plan.billingCycle,
          email,
          name,
          company,
          stripePromoCodeId: applied?.stripePromoCodeId ?? undefined,
        }),
      );

      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planSlug: plan.slug,
          ciclo: plan.billingCycle,
          email,
          name,
          company,
          stripePromoCodeId: applied?.stripePromoCodeId ?? undefined,
        }),
      });

      const data = (await res.json()) as { url?: string; message?: string; code?: string };

      if (!res.ok || !data.url) {
        if (data.code === "EMAIL_ALREADY_EXISTS") {
          setEmailStatus("taken");
        }
        setSubmitError(data.message ?? "Não foi possível iniciar o pagamento.");
        return;
      }

      window.location.href = data.url;
    } catch {
      setSubmitError("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const displayPay = applied
    ? centsToBRL(applied.finalCents)
    : annualTotals
      ? formatBRL(annualTotals.netAnnual)
      : formatBRL(baseMonthlyBrl);

  return (
    <div className="mx-auto grid min-w-0 max-w-5xl gap-10 px-1 sm:px-0 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="order-2 min-w-0 rounded-2xl border border-line bg-surface-card p-6 sm:p-8 lg:order-1">
        <h2 className="font-display text-xl font-bold text-content">Seus dados</h2>
        <p className="mt-1 text-sm text-content-muted">
          Preencha abaixo e você será encaminhado para o pagamento seguro via Stripe.
        </p>
        <form className="mt-8 space-y-5" onSubmit={(e) => void onSubmit(e)}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="fullName" className="text-sm font-medium text-content-secondary">
                Nome completo
              </label>
              <Input
                id="fullName"
                name="fullName"
                required
                autoComplete="name"
                className="mt-1.5"
                placeholder="Seu nome"
              />
            </div>

            {/* Campo de e-mail com verificação em tempo real */}
            <div className="sm:col-span-2">
              <label htmlFor="email" className="text-sm font-medium text-content-secondary">
                E-mail
              </label>
              <div className="relative mt-1.5">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={emailValue}
                  onChange={handleEmailChange}
                  onBlur={handleEmailBlur}
                  placeholder="voce@empresa.com.br"
                  className={
                    emailStatus === "taken"
                      ? "border-rose-500 ring-1 ring-rose-500 focus:border-rose-500 focus:ring-rose-500"
                      : emailStatus === "uncertain"
                        ? "border-amber-500/60 ring-1 ring-amber-500/40"
                        : emailStatus === "available"
                          ? "border-success/60"
                          : ""
                  }
                  aria-invalid={emailStatus === "taken"}
                  aria-describedby="email-status-msg"
                />
                {/* Indicador de loading ao verificar */}
                {emailStatus === "checking" && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  </div>
                )}
                {emailStatus === "available" && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-success">
                    ✓
                  </div>
                )}
              </div>

              {/* Mensagens de feedback do e-mail */}
              <div id="email-status-msg" aria-live="polite">
                {emailStatus === "taken" && (
                  <p className="mt-1.5 text-sm text-rose-500">
                    Este e-mail já está cadastrado. Tente outro e-mail ou{" "}
                    <Link href="/login" className="font-medium underline underline-offset-2">
                      faça login aqui →
                    </Link>
                  </p>
                )}
                {emailStatus === "uncertain" && (
                  <p className="mt-1.5 text-sm text-amber-600 dark:text-amber-400">
                    Não foi possível confirmar automaticamente. Pode continuar — se o e-mail já tiver conta, o
                    pagamento será bloqueado.
                  </p>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="company" className="text-sm font-medium text-content-secondary">
                Empresa <span className="font-normal text-content-faint">(opcional)</span>
              </label>
              <Input
                id="company"
                name="company"
                autoComplete="organization"
                className="mt-1.5"
                placeholder="Razão social ou nome fantasia"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 text-sm text-content-muted">
            <input
              type="checkbox"
              required
              className="mt-1 h-4 w-4 shrink-0 rounded border-line accent-primary"
            />
            <span>
              Li e aceito os{" "}
              <Link href="/termos" className="text-primary underline-offset-2 hover:underline">
                Termos de Uso
              </Link>{" "}
              e a{" "}
              <Link href="/privacidade" className="text-primary underline-offset-2 hover:underline">
                Política de Privacidade
              </Link>
              .
            </span>
          </label>

          {submitError ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
              <p className="text-sm text-rose-500">{submitError}</p>
              {emailStatus === "taken" ? (
                <Link
                  href="/login"
                  className="mt-1 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  Ir para o login →
                </Link>
              ) : null}
            </div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            variant="gradient"
            className="w-full"
            isLoading={loading}
            disabled={!canSubmit}
          >
            {loading
              ? "Redirecionando…"
              : plan.billingCycle === "annual" && !applied
                ? `Ir para o pagamento · ${displayPay} (anual)`
                : `Ir para o pagamento · ${displayPay}`}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-content-faint">
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                clipRule="evenodd"
              />
            </svg>
            Pagamento 100% seguro — processado pelo Stripe
          </p>

          {plan.billingCycle === "annual" && !applied && annualTotals ? (
            <p className="text-center text-[11px] leading-snug text-content-muted">
              Um único pagamento pelos 12 meses · média de {formatBRL(annualTotals.effectiveMonthly)}/mês no ciclo
              promocional.
            </p>
          ) : null}
        </form>
      </div>

      <aside className="order-1 space-y-6 rounded-2xl border border-line bg-surface-deep p-6 sm:p-8 lg:order-2 lg:sticky lg:top-24">
        <div className="rounded-2xl border border-line/80 bg-surface-card p-4 sm:p-5">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-content">
                  Cupom de desconto <span className="font-normal text-content-muted">(opcional)</span>
                </p>
                <p className="text-xs text-content-muted">
                  Pode concluir a compra sem cupom. Se tiver um código, valide aqui — o resumo
                  atualiza após aplicar.
                </p>
              </div>
              {applied ? (
                <button
                  type="button"
                  onClick={clearCoupon}
                  className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  Remover
                </button>
              ) : null}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <Input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder="Opcional — ex.: SOLO15"
                className="font-mono"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="Código do cupom (opcional)"
              />
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                isLoading={couponLoading}
                onClick={() => void applyCoupon()}
              >
                Aplicar cupom
              </Button>
            </div>
            {couponMessage ? (
              <p
                role="status"
                className={`mt-3 text-sm ${applied ? "text-success" : "text-rose-500 dark:text-rose-400"}`}
              >
                {couponMessage}
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">Resumo</p>
          <h3 className="mt-2 font-display text-lg font-bold text-content">{plan.name}</h3>
          <p className="mt-1 text-sm text-content-muted">{plan.tagline}</p>
          <div className="mt-6 space-y-3 border-t border-line pt-6">
            {applied ? (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm text-content-muted">Valor original</span>
                  <span className="font-display text-lg font-semibold text-content line-through decoration-content-faint/60">
                    {centsToBRL(applied.originalCents)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-4 text-success">
                  <span className="text-sm">Desconto</span>
                  <span className="text-lg font-semibold">−{centsToBRL(applied.discountCents)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-line/60 pt-3">
                  <span className="text-sm font-semibold text-content-secondary">Total a pagar</span>
                  <span className="font-display text-2xl font-bold text-primary">
                    {centsToBRL(applied.finalCents)}
                  </span>
                </div>
                <p className="text-xs text-content-faint">
                  {applied.discountRecurrence === "first_cycle"
                    ? "Desconto válido no primeiro ciclo; renovações pelo valor cheio até novo acordo."
                    : "Desconto recorrente conforme regras do cupom e contrato."}
                </p>
              </>
            ) : (
              <div className="space-y-3">
                {plan.billingCycle === "annual" && annualTotals ? (
                  <>
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-sm text-content-muted">Total bruto (12× mensal de lista)</span>
                      <span className="font-display text-lg font-semibold tabular-nums text-content line-through decoration-content-faint/55">
                        {formatBRL(annualTotals.grossAnnual)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 text-success">
                      <span className="text-sm">Desconto no anual ({PLAN_ANNUAL_DISCOUNT_PERCENT}%)</span>
                      <span className="text-sm font-semibold tabular-nums">
                        −{formatBRL(annualTotals.discountAnnual)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 border-t border-line/60 pt-3">
                      <span className="text-sm font-semibold text-content-secondary">Total a pagar (anual)</span>
                      <span className="font-display text-2xl font-bold tabular-nums text-primary">
                        {formatBRL(annualTotals.netAnnual)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-sm text-content-muted">Equivale a por mês</span>
                      <span className="font-display text-lg font-semibold tabular-nums text-content">
                        {formatBRL(annualTotals.effectiveMonthly)}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-content-muted">
                      Cobrança em{" "}
                      <span className="font-medium text-content-secondary">um único pagamento</span>{" "}
                      pelo período de 12 meses.
                    </p>
                  </>
                ) : (
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-content-muted">Cobrança mensal</span>
                    <span className="font-display text-2xl font-bold text-content">
                      {formatBRL(baseMonthlyBrl)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="mt-4 text-xs text-content-faint">
            {plan.billingCycle === "monthly"
              ? "Cobrança mensal recorrente. Cancele quando quiser (conforme termos)."
              : "Ciclo anual: valor total dos 12 meses à vista com desconto. Cancele quando quiser (conforme termos)."}
          </p>
          <ul className="mt-6 space-y-2 text-xs text-content-muted">
            <li className="flex gap-2">
              <span className="text-success" aria-hidden>✓</span>
              API oficial Meta (WhatsApp Business) — 1 número incluído; cada extra +{formatBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês
            </li>
            <li className="flex gap-2">
              <span className="text-success" aria-hidden>✓</span>
              Ambiente seguro com criptografia em trânsito (TLS)
            </li>
            <li className="flex gap-2">
              <span className="text-success" aria-hidden>✓</span>
              Nota fiscal e suporte comercial MyChatCRM
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
