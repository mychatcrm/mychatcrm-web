"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
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

export function CheckoutView({ plan }: { plan: CheckoutPlanSummary }) {
  const baseMonthlyBrl = planEffectiveMonthlyBRL(plan.priceMonthly, plan.billingCycle);
  const annualTotals =
    plan.billingCycle === "annual" ? planAnnualCheckoutTotalsBRL(plan.priceMonthly) : null;

  const [step, setStep] = useState<"form" | "success">("form");
  const [loading, setLoading] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [applied, setApplied] = useState<Extract<CouponValidateResult, { ok: true }> | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const applyCoupon = useCallback(async () => {
    if (!normalizeCouponCode(couponInput)) {
      setApplied(null);
      setCouponMessage(null);
      return;
    }
    setCouponLoading(true);
    setCouponMessage(null);
    try {
      const emailEl = document.getElementById("email") as HTMLInputElement | null;
      const email = emailEl?.value?.trim() ?? "";
      const res = await fetch("/api/checkout/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponInput,
          planSlug: plan.slug,
          email: email || undefined,
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
  }, [couponInput, plan.slug, plan.billingCycle]);

  const clearCoupon = () => {
    setApplied(null);
    setCouponMessage(null);
    setCouponInput("");
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    setLoading(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "").trim();

    try {
      if (applied) {
        const res = await fetch("/api/checkout/coupon/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: applied.code,
            planSlug: plan.slug,
            email,
            ciclo: plan.billingCycle === "annual" ? "anual" : "mensal",
            idempotencyKey:
              typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `idem-${Date.now()}`,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setSubmitError(data?.message ?? "Não foi possível confirmar o cupom no servidor.");
          return;
        }
      }

      await new Promise((r) => setTimeout(r, 800));
      setStep("success");
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

  if (step === "success") {
    return (
      <div className="mx-auto w-full min-w-0 max-w-lg rounded-3xl border border-line bg-surface-card px-5 py-10 text-center shadow-card-hover-glow sm:px-8 sm:py-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-3xl text-success">
          ✓
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold text-content">Assinatura registrada (demo)</h2>
        <p className="mt-3 text-sm text-content-muted">
          Em produção, aqui você veria a confirmação do gateway de pagamento e o e-mail com o acesso ao painel.
        </p>
        {applied ? (
          <div className="mt-4 space-y-1 rounded-xl border border-line bg-surface-deep px-4 py-3 text-left text-sm text-content-secondary">
            <p>
              <span className="text-content-muted">Cupom:</span>{" "}
              <span className="font-mono font-semibold text-primary">{applied.code}</span>
            </p>
            <p>
              <span className="text-content-muted">Desconto (1º ciclo):</span> {centsToBRL(applied.discountCents)}
            </p>
            <p>
              <span className="text-content-muted">Total pago (referência):</span>{" "}
              <span className="font-semibold text-content">{centsToBRL(applied.finalCents)}</span>
            </p>
          </div>
        ) : null}
        <p className="mt-4 rounded-xl border border-line bg-surface-deep px-4 py-3 font-mono text-xs text-content-secondary">
          Pedido #{plan.slug.toUpperCase()}-{Date.now().toString(36).slice(-6).toUpperCase()}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <LinkButton href="/login" size="lg" variant="gradient" className="w-full sm:w-auto">
            Ir para o login
          </LinkButton>
          <LinkButton href="/planos" size="lg" variant="secondary" className="w-full sm:w-auto">
            Voltar aos planos
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid min-w-0 max-w-5xl gap-10 px-1 sm:px-0 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="order-2 min-w-0 rounded-3xl border border-line bg-surface-card p-6 sm:p-8 lg:order-1">
        <h2 className="font-display text-xl font-bold text-content">Dados de pagamento</h2>
        <p className="mt-1 text-sm text-content-muted">
          Ambiente de demonstração — nenhum dado real é enviado ou armazenado.
        </p>
        <form className="mt-8 space-y-5" onSubmit={(e) => void onSubmit(e)}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="fullName" className="text-sm font-medium text-content-secondary">
                Nome completo
              </label>
              <Input id="fullName" name="fullName" required autoComplete="name" className="mt-1.5" placeholder="Seu nome" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="email" className="text-sm font-medium text-content-secondary">
                E-mail corporativo
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1.5"
                placeholder="voce@empresa.com.br"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="company" className="text-sm font-medium text-content-secondary">
                Empresa (opcional)
              </label>
              <Input id="company" name="company" autoComplete="organization" className="mt-1.5" placeholder="Razão social ou nome fantasia" />
            </div>
            <div>
              <label htmlFor="doc" className="text-sm font-medium text-content-secondary">
                CPF / CNPJ
              </label>
              <Input id="doc" name="doc" required className="mt-1.5" placeholder="000.000.000-00" />
            </div>
            <div>
              <label htmlFor="phone" className="text-sm font-medium text-content-secondary">
                WhatsApp
              </label>
              <Input id="phone" name="phone" type="tel" required className="mt-1.5" placeholder="(11) 99999-9999" />
            </div>
          </div>

          <div className="border-t border-line pt-6">
            <p className="text-sm font-semibold text-content-secondary">Cartão (simulado)</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="card" className="text-sm font-medium text-content-secondary">
                  Número do cartão
                </label>
                <Input id="card" name="card" inputMode="numeric" required className="mt-1.5" placeholder="4242 4242 4242 4242" />
              </div>
              <div>
                <label htmlFor="exp" className="text-sm font-medium text-content-secondary">
                  Validade
                </label>
                <Input id="exp" name="exp" required className="mt-1.5" placeholder="MM/AA" />
              </div>
              <div>
                <label htmlFor="cvv" className="text-sm font-medium text-content-secondary">
                  CVV
                </label>
                <Input id="cvv" name="cvv" required className="mt-1.5" placeholder="123" maxLength={4} />
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 text-sm text-content-muted">
            <input type="checkbox" required className="mt-1 h-4 w-4 shrink-0 rounded border-line accent-primary" />
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

          {submitError ? <p className="text-sm text-rose-500">{submitError}</p> : null}

          <Button type="submit" size="lg" variant="gradient" className="w-full" isLoading={loading}>
            {plan.billingCycle === "annual" && !applied ? `Pagar ${displayPay} (total anual) e ativar` : `Pagar ${displayPay} e ativar`}
          </Button>
          {plan.billingCycle === "annual" && !applied && annualTotals ? (
            <p className="text-center text-[11px] leading-snug text-content-muted">
              Um único pagamento pelos 12 meses · média de {formatBRL(annualTotals.effectiveMonthly)}/mês no ciclo
              promocional.
            </p>
          ) : null}
        </form>
      </div>

      <aside className="order-1 space-y-6 rounded-3xl border border-line bg-surface-deep p-6 sm:p-8 lg:order-2 lg:sticky lg:top-24">
        <div className="rounded-2xl border border-line/80 bg-surface-card/60 p-4 shadow-inset-hairline sm:p-5">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-content">
                  Cupom de desconto <span className="font-normal text-content-muted">(opcional)</span>
                </p>
                <p className="text-xs text-content-muted">
                  Pode concluir a compra sem cupom. Se tiver um código, valide aqui — o resumo atualiza após aplicar (e-mail do
                  formulário necessário só para cupons com limite por conta).
                </p>
              </div>
              {applied ? (
                <button type="button" onClick={clearCoupon} className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline">
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
              <Button type="button" variant="secondary" className="w-full" isLoading={couponLoading} onClick={() => void applyCoupon()}>
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
                  <span className="font-display text-2xl font-bold text-primary">{centsToBRL(applied.finalCents)}</span>
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
                      <span className="text-sm font-semibold tabular-nums">−{formatBRL(annualTotals.discountAnnual)}</span>
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
                      Cobrança em <span className="font-medium text-content-secondary">um único pagamento</span> pelo
                      período de 12 meses. Se optar por parcelar no cartão, juros e encargos seguem as regras do seu banco
                      e do processador de pagamentos (adquirente) usado na finalização — não estão incluídos neste
                      total.
                    </p>
                  </>
                ) : (
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-content-muted">Cobrança mensal</span>
                    <span className="font-display text-2xl font-bold text-content">{formatBRL(baseMonthlyBrl)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="mt-4 text-xs text-content-faint">
            {plan.billingCycle === "monthly"
              ? "Cobrança mensal recorrente. Cancele quando quiser (conforme termos)."
              : "Ciclo anual: o valor total do resumo contempla 12 meses à vista com desconto sobre a lista. Cancele quando quiser (conforme termos)."}
          </p>
          <ul className="mt-6 space-y-2 text-xs text-content-muted">
            <li className="flex gap-2">
              <span className="text-success" aria-hidden>
                ✓
              </span>
              API oficial Meta (WhatsApp Business) — 1 número incluído; cada número extra +{formatBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês
            </li>
            <li className="flex gap-2">
              <span className="text-success" aria-hidden>
                ✓
              </span>
              Ambiente seguro com criptografia em trânsito (TLS)
            </li>
            <li className="flex gap-2">
              <span className="text-success" aria-hidden>
                ✓
              </span>
              Nota fiscal e suporte comercial MyChatCRM
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
