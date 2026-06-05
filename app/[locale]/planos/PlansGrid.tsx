"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn, formatBRL } from "@/lib/utils";
import { PLAN_ANNUAL_DISCOUNT_PERCENT, SALES_PLANS, planEffectiveMonthlyBRL, type PlanBillingCycle, type SalesPlan } from "@/lib/plans";

function PlanCard({
  plan,
  highlighted,
  billingCycle,
}: {
  plan: SalesPlan;
  highlighted: boolean;
  billingCycle: PlanBillingCycle;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const checkout = !plan.contactOnly && plan.priceMonthly != null;

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  const isPopular = plan.accent === "popular";
  const isEnterprise = plan.accent === "enterprise";
  const effectiveMonthly = checkout && plan.priceMonthly != null ? planEffectiveMonthlyBRL(plan.priceMonthly, billingCycle) : null;
  const checkoutHref = checkout
    ? `/checkout/${plan.slug}${billingCycle === "annual" ? "?ciclo=anual" : ""}`
    : "/planos#especialista";

  const cardClass = cn(
    "group flex h-full flex-col rounded-2xl border bg-surface-card p-7 transition-colors duration-150",
    isPopular && "border-2 border-primary bg-surface-card",
    isEnterprise && "border-primary/40 bg-surface-deep",
    !isPopular && !isEnterprise && "border-line hover:border-primary",
    highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-surface-base",
  );

  const inner = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold text-content">{plan.name}</h2>
          <p className="mt-1 text-sm text-content-muted">{plan.tagline}</p>
        </div>
        {plan.badge ? (
          <Badge
            className={cn(
              "shrink-0 border-transparent text-xs font-semibold",
              isPopular && "bg-primary text-white",
              isEnterprise && "bg-surface-elevated text-primary",
              !isPopular && !isEnterprise && "bg-primary/15 text-primary",
            )}
          >
            {plan.badge}
          </Badge>
        ) : null}
      </div>

      <p className="mt-6 font-display text-4xl font-bold tracking-tight text-content">
        {checkout && effectiveMonthly != null ? (
          <>
            {formatBRL(effectiveMonthly)}
            <span className="text-base font-medium text-content-muted">/mês</span>
          </>
        ) : (
          <span className="text-3xl sm:text-4xl">Sob consulta</span>
        )}
      </p>
      {billingCycle === "annual" && checkout ? (
        <p className="mt-1 text-xs font-medium text-primary">
          Assinatura anual (12 meses) · {PLAN_ANNUAL_DISCOUNT_PERCENT}% OFF sobre o preço mensal de lista
        </p>
      ) : null}
      {!isEnterprise ? (
        <p className="mt-2 text-xs text-content-muted">
          {plan.monthlyLeadsLabel} · {plan.whatsappNumbers}
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-content-muted">
          Pacote, canais e limites operacionais são definidos em proposta comercial — sem lista fixa na vitrine.
        </p>
      )}

      {isEnterprise ? (
        <div className="mt-8 flex-1 rounded-xl border border-line/70 bg-surface-deep/25 px-4 py-5 text-sm leading-relaxed text-content-secondary">
          <p className="font-medium text-content">Conta Enterprise</p>
          <p className="mt-2">
            Indicado para operações que precisam de volumes, integrações e acompanhamento alinhados ao contrato. Fale com o
            comercial para desenhar o pacote certo para o seu perfil.
          </p>
        </div>
      ) : (
        <ul className="mt-8 flex-1 space-y-2.5 text-sm text-content-secondary">
          {plan.features.map((f) => (
            <li key={f} className="flex gap-2">
              <span className="text-primary" aria-hidden>
                ✓
              </span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}

      {!isEnterprise ? (
        <p className="mt-6 flex gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2.5 text-[11px] leading-snug text-content-secondary sm:text-xs">
          <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
          <span>
            <span className="font-semibold text-content">Lembrete:</span> em todos os planos você tem{" "}
            <span className="font-semibold text-primary">7 dias</span> para pedir reembolso se não gostar do MyChatCRM
            (conforme condições da contratação).
          </span>
        </p>
      ) : (
        <p className="mt-6 rounded-xl border border-line/70 bg-surface-deep/20 px-3 py-2.5 text-[11px] leading-snug text-content-muted sm:text-xs">
          Garantias e SLA fazem parte da proposta comercial assinada.
        </p>
      )}

      <span className="mt-8 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-primary text-center text-base font-semibold text-white transition-colors group-hover:bg-primary-hover">
        {checkout ? "Continuar para pagamento" : "Agendar conversa comercial"}
      </span>
    </>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35 }}
    >
      {checkout ? (
        <Link
          ref={ref}
          href={checkoutHref}
          className={cardClass}
          aria-label={`Assinar plano ${plan.name} — ir ao checkout`}
        >
          {inner}
        </Link>
      ) : (
        <Link
          ref={ref}
          href={checkoutHref}
          className={cardClass}
          aria-label={`Plano ${plan.name} — falar com especialista`}
        >
          {inner}
        </Link>
      )}
    </motion.div>
  );
}

export function PlansGrid({ billingCycle }: { billingCycle: PlanBillingCycle }) {
  const search = useSearchParams();
  const destaque = search?.get("destaque")?.toLowerCase() ?? "";

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-2 xl:grid-cols-4 xl:gap-8 lg:px-8">
      {SALES_PLANS.map((plan) => (
        <PlanCard key={plan.slug} plan={plan} highlighted={destaque === plan.slug} billingCycle={billingCycle} />
      ))}
    </div>
  );
}
