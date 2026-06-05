"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Info, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { linkButtonClass } from "@/components/ui/LinkButton";
import { useTranslations } from "next-intl";
import {
  EXTRA_AGENT_MONTHLY_BRL,
  getPlanIncludedAgentLimit,
  getPlanMaxCollaboratorsTotal,
  getPlanMaxSalesFunnels,
  getPlanMonthlyConversationCap,
} from "@/lib/plan-limits";
import { SALES_PLANS, type SalesPlan } from "@/lib/plans";
import { cn, formatBRL, formatCompactNumber } from "@/lib/utils";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";

type CheckoutPlanSlug = "solo" | "equipa" | "escala";

type PlanFit = {
  slug: CheckoutPlanSlug | "enterprise";
  plan: SalesPlan | undefined;
  /** Base + agentes extras (quando há preço fixo). */
  monthlyTotal: number | null;
  extraAgents: number;
  reasons: string[];
};

const solo = SALES_PLANS.find((p) => p.slug === "solo")!;
const equipa = SALES_PLANS.find((p) => p.slug === "equipa")!;
const escala = SALES_PLANS.find((p) => p.slug === "escala")!;
const enterprise = SALES_PLANS.find((p) => p.slug === "enterprise")!;

/** Solo: uma conta; não usar `getPlanMaxCollaboratorsTotal("solo")` (é 0 na hierarquia). */
const MAX_TEAM_SOLO = 1;
const MAX_TEAM_EQUIPA = getPlanMaxCollaboratorsTotal("equipa");
const MAX_TEAM_ESCALA = getPlanMaxCollaboratorsTotal("escala");
const MAX_TEAM_SLIDER = MAX_TEAM_ESCALA;

/** Referência fixa da simulação (custo “stack atual” — sliders). */
const REFERENCE_COST_PER_ATTENDANT_MONTH = 3500;
const REFERENCE_COST_PER_LOST_LEAD = 150;
const MIN_LOST_LEADS = 20;
const MAX_LOST_LEADS = 120;

const SLUG_ORDER: Record<CheckoutPlanSlug, number> = { solo: 0, equipa: 1, escala: 2 };

/**
 * Perfil operacional estimado a partir do n.º de atendentes (coerente com operações maiores).
 * Usado só para cruzar limites de /planos — não substitui diagnóstico comercial.
 */
function usageProfileFromTeam(teamRaw: number) {
  const team = Math.max(1, Math.round(teamRaw));
  const funnels = Math.min(getPlanMaxSalesFunnels("escala"), Math.max(1, Math.ceil(team / 2.5)));
  const conversations = Math.min(
    getPlanMonthlyConversationCap("escala"),
    Math.max(getPlanMonthlyConversationCap("solo"), team * 220),
  );
  const aiAgents = Math.min(
    getPlanIncludedAgentLimit("escala"),
    Math.max(getPlanIncludedAgentLimit("solo"), Math.ceil(team / 3) + 1),
  );
  return { team, funnels, conversations, aiAgents };
}

function formatBRLDec(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatBRLNoCents(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function monthlyForPlan(
  slug: CheckoutPlanSlug,
  aiAgentsWanted: number,
): { base: number; extraAgents: number; total: number } {
  const plan = SALES_PLANS.find((p) => p.slug === slug)!;
  const included = getPlanIncludedAgentLimit(slug);
  const extraAgents = Math.max(0, Math.round(aiAgentsWanted) - included);
  const base = plan.priceMonthly!;
  const total = base + extraAgents * EXTRA_AGENT_MONTHLY_BRL;
  return { base, extraAgents, total };
}

function fitsCheckoutPlan(slug: CheckoutPlanSlug, team: number, funnels: number, conversations: number): boolean {
  const maxTeam = slug === "solo" ? MAX_TEAM_SOLO : slug === "equipa" ? MAX_TEAM_EQUIPA : MAX_TEAM_ESCALA;
  if (team > maxTeam) return false;
  if (funnels > getPlanMaxSalesFunnels(slug)) return false;
  if (conversations > getPlanMonthlyConversationCap(slug)) return false;
  return true;
}

function buildPlanFit(
  slug: CheckoutPlanSlug,
  team: number,
  funnels: number,
  conversations: number,
  aiAgents: number,
): PlanFit | null {
  if (!fitsCheckoutPlan(slug, team, funnels, conversations)) return null;
  const { total, extraAgents } = monthlyForPlan(slug, aiAgents);
  const p = SALES_PLANS.find((x) => x.slug === slug)!;
  const reasons: string[] = [];
  if (slug === "solo") reasons.push("Até 1 lugar na operação, com limites Solo de funis e novas conversas.");
  if (slug === "equipa") reasons.push("Cabe na hierarquia Equipa e nos limites de funis e novas conversas desse plano.");
  if (slug === "escala") reasons.push("Cabe na hierarquia Escala e nos limites de funis e novas conversas desse plano.");
  if (extraAgents > 0) {
    reasons.push(
      `${extraAgents} agente(s) IA além do pacote incluído (+ ${formatBRLDec(EXTRA_AGENT_MONTHLY_BRL)}/cada).`,
    );
  }
  return { slug, plan: p, monthlyTotal: total, extraAgents, reasons };
}

/** Entre os planos com checkout que cumprem limites, escolhe o de menor custo mensal (incl. extras de IA). */
function recommendBestPlan(team: number, funnels: number, conversations: number, aiAgents: number): PlanFit {
  const t = Math.max(1, Math.round(team));
  const F = Math.max(1, Math.round(funnels));
  const C = Math.max(0, Math.round(conversations));
  const A = Math.max(0, Math.round(aiAgents));

  const candidates = (["solo", "equipa", "escala"] as const)
    .map((slug) => buildPlanFit(slug, t, F, C, A))
    .filter((x): x is PlanFit => x != null);

  if (candidates.length === 0) {
    const blockers: string[] = [];
    if (t > MAX_TEAM_ESCALA) blockers.push(`mais de ${MAX_TEAM_ESCALA} lugares na equipa comercial`);
    if (F > getPlanMaxSalesFunnels("escala")) blockers.push(`acima de ${getPlanMaxSalesFunnels("escala")} funis no Escala`);
    if (C > getPlanMonthlyConversationCap("escala")) {
      blockers.push(`acima de ${formatCompactNumber(C)} novas conversas/mês no Escala`);
    }
    return {
      slug: "enterprise",
      plan: enterprise,
      monthlyTotal: null,
      extraAgents: 0,
      reasons: blockers.length
        ? [`Perfil fora dos tetos dos planos com preço fixo (${blockers.join("; ")}).`]
        : ["Volume ou escopo negociável — fechamos limites e valores na reunião comercial."],
    };
  }

  return candidates.reduce((best, cur) => {
    if (cur.monthlyTotal! < best.monthlyTotal!) return cur;
    if (cur.monthlyTotal! > best.monthlyTotal!) return best;
    const a = SLUG_ORDER[cur.slug as CheckoutPlanSlug];
    const b = SLUG_ORDER[best.slug as CheckoutPlanSlug];
    return a < b ? cur : best;
  });
}

const PRESETS = [
  { id: "preset-solo", planName: solo.name, team: 1 },
  { id: "preset-equipa", planName: equipa.name, team: 8 },
  { id: "preset-escala", planName: escala.name, team: 28 },
] as const;

export function SavingsCalculator() {
  const t = useTranslations("landing.savings");
  const tCommon = useTranslations("common.buttons");
  const [team, setTeam] = useState(1);
  const [lostLeads, setLostLeads] = useState(MIN_LOST_LEADS);

  const profile = useMemo(() => usageProfileFromTeam(team), [team]);
  const fit = useMemo(
    () => recommendBestPlan(profile.team, profile.funnels, profile.conversations, profile.aiAgents),
    [profile],
  );

  const activeExampleId = useMemo(() => {
    const m = PRESETS.find((p) => p.team === team);
    return m?.id ?? null;
  }, [team]);

  const peopleCost = Math.max(1, team) * REFERENCE_COST_PER_ATTENDANT_MONTH;
  const leadsCost = lostLeads * REFERENCE_COST_PER_LOST_LEAD;
  const currentStackMonthly = peopleCost + leadsCost;

  const mychatMonthly = fit.monthlyTotal;
  const hasFixedMychat = mychatMonthly != null;
  const monthlySavings = hasFixedMychat ? currentStackMonthly - mychatMonthly : null;
  const hasPositiveSavings = monthlySavings != null && monthlySavings > 0;
  const ratio =
    hasFixedMychat && mychatMonthly > 0 && currentStackMonthly > 0 ? currentStackMonthly / mychatMonthly : null;

  const caps =
    fit.slug !== "enterprise" && fit.slug
      ? {
          team:
            fit.slug === "solo" ? MAX_TEAM_SOLO : fit.slug === "equipa" ? MAX_TEAM_EQUIPA : MAX_TEAM_ESCALA,
          funnelsMax: getPlanMaxSalesFunnels(fit.slug),
          conv: getPlanMonthlyConversationCap(fit.slug),
          agentsIncl: getPlanIncludedAgentLimit(fit.slug),
        }
      : null;

  const whatsappHref = whatsappHandoffHref();

  return (
    <section
      id="economia"
      className="relative scroll-mt-24 border-y border-line/50 bg-surface-deep/80 py-16 sm:py-20"
      aria-labelledby="economia-titulo"
    >
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{t("eyebrow")}</p>
          <h2
            id="economia-titulo"
            className="mt-2 font-display text-3xl font-bold tracking-tight text-content sm:text-4xl"
          >
            {t("heading")}
          </h2>
          <div className="title-accent-line mx-auto" aria-hidden />
          <p className="mt-4 text-sm leading-relaxed text-content-secondary sm:text-base">
            {t("subheadingPart1")} <strong className="font-semibold text-content">{t("subheadingAttendants")}</strong> {t("subheadingAnd")}{" "}
            <strong className="font-semibold text-content">{t("subheadingLostLeads")}</strong>{t("subheadingPart2")}{" "}
            <strong className="font-semibold text-content">{t("subheadingUsageProfile")}</strong> {t("subheadingPart3")}{" "}
            <Link href="/planos" className="font-semibold text-primary underline-offset-2 hover:underline">
              {t("subheadingPlans")}
            </Link>
            {t("subheadingPart4")} <strong className="font-semibold text-content">{t("subheadingCheapest")}</strong>{" "}
            {t("subheadingPart5")}{" "}
            <strong className="font-semibold text-content">{t("subheadingUnlimited")}</strong> {t("subheadingPart6")}
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-line/70 bg-surface-card/50 p-4 sm:p-5">
          <div className="mx-auto max-w-xl text-center">
            <p id="economia-cenarios" className="text-sm font-semibold text-content">
              {t("shortcutHeading")}
            </p>
            <p className="mt-1 text-xs leading-snug text-content-muted">
              <strong className="font-medium text-content-secondary">{t("oneClick")}</strong> {t("shortcutSubContinue")}
            </p>
          </div>
          <div
            className="mt-4 grid gap-2.5 sm:grid-cols-3 sm:gap-3"
            role="radiogroup"
            aria-labelledby="economia-cenarios"
          >
            {PRESETS.map((p) => {
              const selected = activeExampleId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={t("applyExampleAriaLabel", { planName: p.planName, team: p.team })}
                  onClick={() => setTeam(p.team)}
                  className={cn(
                    "flex min-h-[44px] flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-deep",
                    selected
                      ? "border-primary/55 bg-primary/[0.12]"
                      : "border-line/90 bg-surface-elevated/25 hover:border-primary/35 hover:bg-surface-elevated/40",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="font-display text-base font-bold tracking-tight text-content">{p.planName}</span>
                  </span>
                  <span className="text-[11px] text-content-muted">
                    {p.team} {p.team === 1 ? t("attendant") : t("attendants")} · {t("example")}
                  </span>
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    {selected ? t("active") : t("clickToApply")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-12 lg:gap-8">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-8%" }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="lg:col-span-7 flex h-full min-h-0 flex-col rounded-2xl border border-line/80 bg-surface-card p-4 sm:p-5"
            >
              <div className="border-b border-line/45 pb-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-content-muted">{t("paramsTitle")}</p>
                <p className="mt-0.5 text-xs leading-snug text-content-secondary">{t("paramsSub")}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-line/50 bg-surface-deep/40 px-3 py-2.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-elevated/50 px-2 py-1 text-[10px] font-medium text-content-secondary">
                  <Info className="size-3 shrink-0 text-primary" aria-hidden />
                  {t("estimatedProfile", { funnels: profile.funnels, conversations: formatCompactNumber(profile.conversations), aiAgents: profile.aiAgents })}
                </span>
              </div>

              <div className="mt-3 flex flex-col gap-3">
                <div className="rounded-xl border border-line/50 bg-surface-elevated/[0.1] p-3 sm:p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="calc-attendants" className="text-[13px] font-medium leading-tight text-content">
                      {t("attendantsLabel")}
                    </label>
                    <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {team} {team === 1 ? t("attendant") : t("attendants")}
                    </span>
                  </div>
                  <input
                    id="calc-attendants"
                    type="range"
                    min={1}
                    max={MAX_TEAM_SLIDER}
                    step={1}
                    value={team}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setTeam(Number.isFinite(n) ? Math.max(1, Math.min(MAX_TEAM_SLIDER, Math.round(n))) : 1);
                    }}
                    className="mt-2 h-1.5 w-full cursor-pointer accent-primary"
                    aria-valuemin={1}
                    aria-valuemax={MAX_TEAM_SLIDER}
                    aria-valuenow={team}
                    aria-valuetext={t("attendantValueText", { count: team })}
                  />
                  <RefCallout>
                    <p className="text-[11px] leading-snug text-content-muted">
                      {formatBRLNoCents(REFERENCE_COST_PER_ATTENDANT_MONTH)}/atendente · Subtotal{" "}
                      <span className="font-semibold tabular-nums text-content">{formatBRLNoCents(peopleCost)}/mês</span>
                    </p>
                  </RefCallout>
                </div>

                <div className="rounded-xl border border-line/50 bg-surface-elevated/[0.1] p-3 sm:p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="calc-lost" className="text-[13px] font-medium leading-tight text-content">
                      {t("lostLeadsLabel")}
                    </label>
                    <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {lostLeads} {lostLeads === 1 ? t("lead") : t("leads")}
                    </span>
                  </div>
                  <input
                    id="calc-lost"
                    type="range"
                    min={MIN_LOST_LEADS}
                    max={MAX_LOST_LEADS}
                    step={1}
                    value={lostLeads}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setLostLeads(
                        Number.isFinite(n)
                          ? Math.max(MIN_LOST_LEADS, Math.min(MAX_LOST_LEADS, Math.round(n)))
                          : MIN_LOST_LEADS,
                      );
                    }}
                    className="mt-2 h-1.5 w-full cursor-pointer accent-primary"
                    aria-valuemin={MIN_LOST_LEADS}
                    aria-valuemax={MAX_LOST_LEADS}
                    aria-valuenow={lostLeads}
                    aria-valuetext={t("lostLeadsValueText", { count: lostLeads })}
                  />
                  <RefCallout>
                    <p className="text-[11px] leading-snug text-content-muted">
                      {formatBRLNoCents(REFERENCE_COST_PER_LOST_LEAD)}/lead perdido · Subtotal{" "}
                      <span className="font-semibold tabular-nums text-content">{formatBRLNoCents(leadsCost)}/mês</span>
                    </p>
                  </RefCallout>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-8%" }}
              transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="lg:col-span-5 flex h-full min-h-0 flex-col rounded-2xl border border-primary/25 bg-surface-card p-6 sm:p-8"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Wallet className="size-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">{t("recommendation")}</p>
                  <p className="mt-1 font-display text-2xl font-bold tracking-tight text-content">
                    {fit.plan?.name ?? "Enterprise"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                    {fit.slug === "enterprise" ? t("enterprisePrice") : t("cheapestFixed")}
                  </p>
                </div>
              </div>

              {caps && (
                <ul className="mt-5 space-y-2 rounded-2xl border border-line/60 bg-surface-elevated/35 p-4 text-xs text-content-secondary">
                  <FitRow ok={team <= caps.team} label={t("slots")} value={`${team} / ${caps.team}`} />
                  <FitRow
                    ok={profile.funnels <= caps.funnelsMax}
                    label={t("funnelsEst")}
                    value={`${profile.funnels} / ${caps.funnelsMax}`}
                  />
                  <FitRow
                    ok={profile.conversations <= caps.conv}
                    label={t("conversationsEst")}
                    value={`${formatCompactNumber(profile.conversations)} / ${formatCompactNumber(caps.conv)}`}
                  />
                  <FitRow
                    ok={fit.extraAgents === 0}
                    label={t("aiAgentsEst")}
                    value={
                      fit.extraAgents > 0
                        ? `${profile.aiAgents} (${caps.agentsIncl} ${t("incl")} + ${fit.extraAgents} ${t("extra")})`
                        : `${profile.aiAgents} (${t("incl")} ${caps.agentsIncl})`
                    }
                  />
                </ul>
              )}

              {fit.slug === "enterprise" && (
                <p className="mt-4 text-xs leading-relaxed text-content-secondary">{fit.reasons[0]}</p>
              )}

              {hasFixedMychat && (
                <div className="mt-5">
                  <p className="text-xs font-medium text-content-muted">{t("mychatInvestment")}</p>
                  <p className="mt-1 font-display text-3xl font-bold text-content">{formatBRLDec(mychatMonthly)}/mês</p>
                  {fit.slug !== "enterprise" && (
                    <p className="mt-1 text-[11px] text-content-muted">
                      {fit.extraAgents > 0 ? (
                        <>
                          {formatBRLDec(monthlyForPlan(fit.slug as CheckoutPlanSlug, profile.aiAgents).base)} base +{" "}
                          {fit.extraAgents} × {formatBRLDec(EXTRA_AGENT_MONTHLY_BRL)} (extras).
                        </>
                      ) : (
                        <>{t("baseNoExtras")}</>
                      )}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-line/70 bg-surface-elevated/30 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">{t("currentStack")}</p>
                  <p className="mt-0.5 text-lg font-bold text-content">{formatBRL(Math.round(currentStackMonthly))}</p>
                </div>
                <div className="rounded-2xl border border-primary/25 bg-primary/[0.07] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">{t("savingsPerMonth")}</p>
                  <p className="mt-0.5 text-lg font-bold text-primary">
                    {hasPositiveSavings ? formatBRL(Math.round(monthlySavings!)) : "—"}
                  </p>
                  {hasFixedMychat && !hasPositiveSavings && (
                    <p className="mt-1 text-[10px] leading-snug text-content-muted">{t("belowMonthly")}</p>
                  )}
                </div>
              </div>

              <div className="mt-5 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-content-muted">{t("saveUpTo")}</p>
                <p className="mt-1 font-display text-4xl font-bold text-primary sm:text-5xl">
                  {ratio != null && ratio >= 1.05 ? `${ratio.toFixed(1)}×` : "—"}
                </p>
                <p className="mx-auto mt-1 max-w-xs text-[11px] text-content-muted">
                  {ratio != null && ratio >= 1.05
                    ? t("ratioExplain")
                    : hasFixedMychat && ratio != null && ratio < 1.05
                      ? t("ratioBelow")
                      : hasFixedMychat
                        ? t("ratioIncrease")
                        : t("ratioEnterprise")}
                </p>
              </div>

              <div className="mt-auto flex flex-col gap-3 pt-8">
                <Link
                  href={fit.slug === "enterprise" ? "/planos#especialista" : "/planos"}
                  className={linkButtonClass("gradient", "lg", "w-full justify-center gap-2")}
                >
                  {fit.slug === "enterprise" ? t("talkCommercial") : t("viewPlansCheckout")}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkButtonClass("outline", "md", "w-full justify-center border-line/90")}
                >
                  {tCommon("whatsappExpert")}
                </a>
              </div>
            </motion.div>
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-[11px] leading-relaxed text-content-faint sm:text-xs">
          {t("disclaimer", {
            costPerAttendant: formatBRL(REFERENCE_COST_PER_ATTENDANT_MONTH),
            costPerLead: formatBRL(REFERENCE_COST_PER_LOST_LEAD),
            solo: solo.name,
            equipa: equipa.name,
            escala: escala.name,
          })}{" "}
          <Link href="/planos" className="font-medium text-primary underline-offset-2 hover:underline">
            {t("disclaimerPlans")}
          </Link>
          {t("disclaimerEnd", { extraAgentCost: formatBRL(EXTRA_AGENT_MONTHLY_BRL) })}
        </p>
      </div>
    </section>
  );
}

function RefCallout({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative mt-2 overflow-hidden rounded-lg border border-line/50 bg-surface-deep/45 pl-2 dark:bg-surface-deep/70"
      role="note"
    >
      <div
        className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-primary"
        aria-hidden
      />
      <div className="px-2.5 py-1.5 pl-3 text-[11px] leading-snug text-content-muted">{children}</div>
    </div>
  );
}

function FitRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px]",
            ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/15 text-rose-600 dark:text-rose-400",
          )}
        >
          {ok ? <Check className="size-3" strokeWidth={3} /> : "!"}
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span className="shrink-0 font-medium tabular-nums text-content">{value}</span>
    </li>
  );
}
