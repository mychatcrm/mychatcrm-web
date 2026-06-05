"use client";

import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
  Bot,
  Building2,
  CalendarClock,
  Crown,
  Handshake,
  LayoutGrid,
  Package,
  Plug,
  Rocket,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/LinkButton";
import { SALES_PLANS, type SalesPlan } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

type PlanHighlight = { text: string; icon: typeof Bot };

const LANDING_HIGHLIGHTS: Record<SalesPlan["slug"], PlanHighlight[]> = {
  solo: [
    { text: "IA no WhatsApp com respostas em texto e áudio", icon: Bot },
    { text: "Modo solo — uma conta, sem hierarquia de equipa", icon: User },
    { text: "Até 2 agentes de IA incluídos (+ extras na página de agentes)", icon: Sparkles },
    { text: "CRM Kanban, funis e conversas com limites mensais claros", icon: LayoutGrid },
    { text: "Integrações, desktop e suporte conforme o plano", icon: Plug },
  ],
  equipa: [
    { text: "Atendimento com IA no WhatsApp, disponível o tempo todo", icon: Bot },
    { text: "Treino da IA acompanhado por especialistas", icon: Sparkles },
    { text: "Respostas em texto e em áudio", icon: AudioLines },
    { text: "Formulários e captação de contexto do cliente", icon: LayoutGrid },
    { text: "Integrações com APIs e sistemas externos", icon: Plug },
    { text: "Aplicação desktop para a sua equipa", icon: Rocket },
  ],
  escala: [
    { text: "Tudo o que o plano Equipa oferece", icon: Package },
    { text: "CRM Kanban completo e personalizável para vendas", icon: LayoutGrid },
    { text: "Agenda, eventos e lembretes automáticos", icon: CalendarClock },
    { text: "Disparos e campanhas em massa com segmentação", icon: Send },
    { text: "Hierarquia de equipa (direção, gestão e vendas)", icon: Users },
    { text: "Capacidade ampliada para operações de maior volume", icon: Crown },
  ],
  enterprise: [
    { text: "Conta dedicada com pacote negociado em contrato", icon: Building2 },
    { text: "Limites e entregas alinhados ao perfil do cliente — sem catálogo fixo", icon: ShieldCheck },
    { text: "Conversa comercial para desenhar escopo, valores e cronograma", icon: Handshake },
  ],
};

const EDITORIAL: Record<SalesPlan["slug"], string> = {
  solo: "Para profissionais autónomos que querem a mesma plataforma, com tectos de uso adequados a uma pessoa.",
  equipa: "O núcleo MyChatCRM: IA treinável, voz, integrações e desktop para equipas que querem resposta rápida e consistente.",
  escala: "Pensado para operações que precisam de CRM Kanban, ritmo comercial e automação pesada — sem abdicar da mesma IA forte no WhatsApp.",
  enterprise:
    "Para operações que fecham volume, integrações e condições diretamente com o comercial — cada proposta é única e não segue a lista pública dos outros planos.",
};

type CardTone = "standard" | "featured" | "enterprise";

function toneForSlug(slug: SalesPlan["slug"]): CardTone {
  if (slug === "escala") return "featured";
  if (slug === "enterprise") return "enterprise";
  return "standard";
}

function PlanBadges({ plan }: { plan: SalesPlan }) {
  const t = useTranslations("landing.pricingSection");
  if (plan.slug === "escala") {
    return (
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge className="border-transparent bg-primary text-white">{t("badgeSuiteFull")}</Badge>
        <Badge className="border-primary/40 bg-primary/10 text-primary">{t("badgeMostChosen")}</Badge>
      </div>
    );
  }
  if (plan.slug === "enterprise") {
    return (
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge className="border-line/80 bg-surface-deep/80 text-content-secondary">{t("badgeEnterprise")}</Badge>
        <Badge className="border-primary/35 bg-primary/10 text-primary">{plan.badge ?? t("badgeMostChosen")}</Badge>
      </div>
    );
  }
  if (plan.slug === "solo") {
    return (
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge className="border-line/80 bg-surface-deep/60 text-content-secondary">{t("badgeStarter")}</Badge>
        {plan.badge ? (
          <Badge className="border-primary/35 bg-primary/10 text-primary">{plan.badge}</Badge>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-faint">{t("badgeEntry")}</p>
      {plan.badge ? (
        <Badge className="border-primary/35 bg-primary/10 text-primary">{plan.badge}</Badge>
      ) : null}
    </div>
  );
}

function PlanCard({ plan, delay = 0 }: { plan: SalesPlan; delay?: number }) {
  const t = useTranslations("landing.pricingSection");
  const tCommon = useTranslations("common.buttons");
  const tPlans = useTranslations("plans.plans");
  const tone = toneForSlug(plan.slug);
  const isFeatured = tone === "featured";
  const isEnterprise = tone === "enterprise";
  const highlights = (tPlans.raw(`${plan.slug}.highlights`) as string[]) ?? LANDING_HIGHLIGHTS[plan.slug].map(h => h.text);
  const editorial = tPlans(`${plan.slug}.editorial`);
  const hrefPlans = `/planos?destaque=${plan.slug}`;
  const hrefExpert = "/planos#especialista";

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8%", amount: 0.15 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border p-7 sm:p-8",
        isFeatured &&
          "border-primary/40 bg-surface-card",
        isEnterprise &&
          "border-line/90 bg-surface-card transition-colors duration-150 hover:border-primary/30",
        !isFeatured &&
          !isEnterprise &&
          "border-line/90 bg-surface-card transition-colors duration-150 hover:border-primary/25",
      )}
      style={
        {
          "--spot-x": "50%",
          "--spot-y": "28%",
        } as CSSProperties
      }
      onMouseMove={(e) => {
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
        el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
      }}
    >
      {/* Mantém a área visual estável; o DS evita glow como recurso principal. */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] opacity-0"
        aria-hidden
      />
      {isFeatured ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary"
          aria-hidden
        />
      ) : (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-line"
          aria-hidden
        />
      )}

      <div className="relative z-[2] flex flex-1 flex-col">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <PlanBadges plan={plan} />
            <h3 className="font-display text-2xl font-bold tracking-tight text-content sm:text-[1.55rem]">{plan.name}</h3>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-content-secondary">{plan.tagline}</p>
          </div>
        </div>

        <p className="relative mt-5 rounded-xl border border-line/60 bg-surface-deep/40 px-3 py-2 text-xs leading-snug text-content-muted">
          {editorial}
        </p>

        <ul className="relative mt-6 flex flex-1 flex-col gap-3">
          {highlights.map((text: string, idx: number) => {
            const Icon = LANDING_HIGHLIGHTS[plan.slug]?.[idx]?.icon ?? Bot;
            return (
            <li key={text} className="flex gap-3 text-sm leading-snug text-content-secondary">
              <span
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                  isFeatured
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : isEnterprise
                      ? "border-line bg-surface-deep/70 text-content-muted group-hover:border-primary/25 group-hover:text-primary"
                      : "border-line bg-surface-deep/60 text-content-muted group-hover:border-primary/20 group-hover:text-primary",
                )}
                aria-hidden
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 pt-1">{text}</span>
            </li>
            );
          })}
        </ul>

        <p className="relative mt-6 flex gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-3.5 py-2.5 text-xs leading-snug text-content-secondary sm:text-[13px]">
          <RotateCcw
            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
            strokeWidth={2}
            aria-hidden
          />
          <span>
            <span className="font-semibold text-content">{t("planCardRefundBold")}</span> {t("planCardRefundContinue")}
          </span>
        </p>

        <div className="relative mt-8 flex flex-col gap-2.5 border-t border-line/50 pt-7 sm:flex-row sm:items-stretch">
          {plan.contactOnly ? (
            <>
              <LinkButton
                href={hrefExpert}
                variant="gradient"
                size="lg"
                className="w-full sm:flex-1"
                aria-label={t("scheduleCommercialAriaLabel")}
              >
                {t("scheduleCommercial")}
              </LinkButton>
              <LinkButton
                href={hrefPlans}
                variant="outline"
                size="lg"
                className="w-full border-line/80 bg-transparent sm:flex-1 sm:max-w-[11rem]"
                aria-label={t("viewDetailsAriaLabel")}
              >
                {t("viewDetails")}
              </LinkButton>
            </>
          ) : (
            <>
              <LinkButton
                href={hrefPlans}
                variant="gradient"
                size="lg"
                className="w-full sm:flex-1"
                aria-label={t("explorePlanAriaLabel", { planName: plan.name })}
              >
                {t("exploreInPlans")}
              </LinkButton>
              <LinkButton
                href={hrefExpert}
                variant="outline"
                size="lg"
                className="w-full border-line/80 bg-transparent sm:flex-1 sm:max-w-[11rem]"
                aria-label={t("talkExpertAriaLabel")}
              >
                {tCommon("talkExpert")}
              </LinkButton>
            </>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export function Pricing() {
  const t = useTranslations("landing.pricingSection");

  return (
    <section
      id="planos"
      className="relative scroll-mt-24 overflow-hidden border-y border-line/40 bg-surface-base py-24 sm:py-28"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0"
        aria-hidden
      />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{t("eyebrow")}</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-content sm:text-4xl md:text-[2.35rem] md:leading-tight">
            {t("heading")}
          </h2>
          <div className="title-accent-line mx-auto" aria-hidden />
          <p className="mt-5 text-base leading-relaxed text-content-secondary sm:text-lg">
            {t("subheading")} <span className="font-medium text-content">{t("subheadingPlansLink")}</span>{t("subheadingEnd")}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/planos" variant="gradient" size="md" aria-label={t("viewPricesAriaLabel")}>
              {t("viewPrices")}
            </LinkButton>
            <LinkButton href="/planos#especialista" variant="ghost" size="md" className="text-content-muted hover:text-primary">
              {t("scheduleCommercial")}
            </LinkButton>
          </div>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-2 md:gap-10 md:items-stretch">
          {SALES_PLANS.map((plan, i) => (
            <PlanCard key={plan.slug} plan={plan} delay={i * 0.05} />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="mx-auto mt-14 max-w-2xl text-center text-xs leading-relaxed text-content-faint sm:text-sm"
        >
          {t("disclaimer")}{" "}
          <LinkButton href="/planos" variant="ghost" size="sm" className="inline px-1 font-semibold text-primary">
            /planos
          </LinkButton>
          .
        </motion.p>
      </div>
    </section>
  );
}
