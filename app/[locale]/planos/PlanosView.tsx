"use client";

/**
 * Vitrine de planos — mesma identidade da home ("sala de controle").
 *
 * Toda a informação comercial continua a vir de `lib/plans.ts`: preços, ciclo
 * anual, features por plano e as secções do comparativo. Esta camada só
 * apresenta.
 */

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Minus, ShieldCheck, Sparkles } from "lucide-react";
import {
  EXTERNAL_API_EXTRA_MONTHLY_BRL,
  PLAN_ANNUAL_DISCOUNT_PERCENT,
  PLAN_COMPARISON_SECTIONS,
  SALES_PLANS,
  SALES_PLANS_COMPARISON_COLUMNS,
  WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL,
  planAnnualCheckoutTotalsBRL,
  planEffectiveMonthlyBRL,
  type PlanBillingCycle,
  type PlanComparisonCellValue,
  type SalesPlan,
} from "@/lib/plans";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";
import {
  McxFooter,
  McxNav,
  McxPage,
  Reveal,
  SectionLabel,
  priceBRL,
} from "@/components/marketing/mcx";

/** O primeiro item de `features` é o resumo "tudo incluído"; o resto são os limites. */
function planLimits(plan: SalesPlan): string[] {
  return plan.features.slice(1);
}

function PlanCard({
  plan,
  cycle,
  highlighted,
}: {
  plan: SalesPlan;
  cycle: PlanBillingCycle;
  highlighted: boolean;
}) {
  const checkout = !plan.contactOnly && plan.priceMonthly != null;
  const monthly = checkout ? planEffectiveMonthlyBRL(plan.priceMonthly as number, cycle) : null;
  const annual = checkout ? planAnnualCheckoutTotalsBRL(plan.priceMonthly as number) : null;
  const popular = plan.accent === "popular";
  const href = checkout
    ? `/checkout/${plan.slug}${cycle === "annual" ? "?ciclo=anual" : ""}`
    : "#especialista";

  return (
    <article
      className={popular ? "mcx-card mcx-plan mcx-plan-pop" : "mcx-card mcx-plan"}
      style={{
        height: "100%",
        ...(highlighted ? { borderColor: "var(--brand)", boxShadow: "0 0 0 3px rgba(242,68,0,.2)" } : {}),
        ...(plan.contactOnly
          ? { background: "linear-gradient(180deg,rgba(14,29,41,.85),rgba(255,255,255,.012))" }
          : {}),
      }}
    >
      {popular ? <span className="mcx-plan-badge">{plan.badge}</span> : null}

      <div>
        <h2 className="mcx-h3" style={{ fontSize: "1.28rem", marginBottom: 6 }}>
          {plan.name}
        </h2>
        <p className="mcx-body" style={{ fontSize: ".85rem", minHeight: 54 }}>
          {plan.tagline}
        </p>
      </div>

      <div>
        {monthly != null ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span className="mcx-price">{priceBRL(monthly)}</span>
              <span className="mcx-mono" style={{ letterSpacing: ".1em" }}>
                /mês
              </span>
            </div>
            <p
              className="mcx-mono"
              style={{ marginTop: 7, textTransform: "none", letterSpacing: ".04em" }}
            >
              {cycle === "annual" && annual
                ? `Cobrado anualmente · ${priceBRL(annual.netAnnual)}/ano`
                : "Cobrado mensalmente"}
            </p>
          </>
        ) : (
          <>
            <span className="mcx-price" style={{ fontSize: "1.9rem" }}>
              Sob consulta
            </span>
            <p
              className="mcx-mono"
              style={{ marginTop: 7, textTransform: "none", letterSpacing: ".04em" }}
            >
              Pacote e limites definidos com o comercial
            </p>
          </>
        )}
      </div>

      <div
        style={{
          padding: "12px 14px",
          borderRadius: 11,
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,.025)",
        }}
      >
        <div className="mcx-mono" style={{ marginBottom: 5 }}>
          Incluído
        </div>
        <div style={{ fontSize: ".85rem", color: "var(--text)" }}>{plan.monthlyLeadsLabel}</div>
        <div style={{ fontSize: ".78rem", color: "var(--faint)", marginTop: 3 }}>
          {plan.whatsappNumbers}
        </div>
      </div>

      {plan.contactOnly ? (
        <ul className="mcx-plan-list">
          <li>
            <Check size={13} strokeWidth={3} />
            <span>Volume de leads e agentes à medida</span>
          </li>
          <li>
            <Check size={13} strokeWidth={3} />
            <span>Onboarding e acompanhamento dedicados</span>
          </li>
          <li>
            <Check size={13} strokeWidth={3} />
            <span>Contrato e faturação sob medida</span>
          </li>
        </ul>
      ) : (
        <ul className="mcx-plan-list">
          {planLimits(plan).map((item) => (
            <li key={item}>
              <Check size={13} strokeWidth={3} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mcx-plan-foot">
        <Link
          href={href}
          className={`mcx-btn ${popular ? "mcx-btn-primary" : "mcx-btn-ghost"}`}
          style={{ width: "100%" }}
        >
          {checkout ? `Assinar ${plan.name}` : "Falar com o comercial"}
        </Link>
      </div>
    </article>
  );
}

function ComparisonCell({ value }: { value: PlanComparisonCellValue }) {
  if (typeof value === "string") {
    return (
      <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
        {value}
      </td>
    );
  }
  return (
    <td style={{ textAlign: "center" }}>
      {value ? (
        <Check size={14} strokeWidth={3} style={{ color: "var(--live)" }} aria-label="Incluído" />
      ) : (
        <Minus size={14} style={{ color: "var(--faint)" }} aria-label="Não incluído" />
      )}
    </td>
  );
}

export function PlanosView() {
  const [cycle, setCycle] = useState<PlanBillingCycle>("monthly");
  const params = useSearchParams();
  const highlight = params.get("plano");
  const whatsapp = whatsappHandoffHref();

  // Chegar em /planos?plano=escala destaca e rola até o card, como antes.
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`plano-${highlight}`);
    if (!el) return;
    const id = requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    return () => cancelAnimationFrame(id);
  }, [highlight]);

  return (
    <McxPage>
      <McxNav />

      <main>
        {/* ---------------------------------------------------------------- */}
        <header style={{ position: "relative", overflow: "hidden" }}>
          <div className="mcx-grid" />
          <div
            className="mcx-aurora"
            style={{
              width: 620,
              height: 620,
              top: -300,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(242,68,0,.18)",
            }}
          />
          <div
            className="mcx-shell"
            style={{
              position: "relative",
              zIndex: 1,
              padding: "clamp(52px,7vw,88px) 24px clamp(30px,4vw,44px)",
              textAlign: "center",
            }}
          >
            <span className="mcx-chip" style={{ marginBottom: 22 }}>
              <span className="mcx-dot" />
              Planos e assinaturas
            </span>
            <h1 className="mcx-h1" style={{ maxWidth: 880, margin: "0 auto" }}>
              Escolha o tamanho da sua operação.
            </h1>
            <p className="mcx-lead" style={{ margin: "22px auto 0" }}>
              Todos os planos trazem o produto inteiro — CRM Kanban, agentes de IA, conversas,
              agenda, disparos e integrações. O que muda são os limites.
            </p>

            <div
              className="mcx-card"
              style={{
                maxWidth: 640,
                margin: "30px auto 0",
                padding: "16px 20px",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                textAlign: "left",
                borderColor: "rgba(25,206,114,.3)",
                background: "var(--live-dim)",
              }}
            >
              <ShieldCheck size={17} style={{ color: "var(--live)", flexShrink: 0, marginTop: 2 }} />
              <p className="mcx-body" style={{ fontSize: ".9rem", color: "var(--text)" }}>
                <strong style={{ fontWeight: 600 }}>7 dias para pedir reembolso</strong> nos planos
                com checkout online (Solo, Equipa e Escala), se não ficar satisfeito — condições no
                momento da contratação. Enterprise segue a proposta assinada.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px 22px",
                justifyContent: "center",
                marginTop: 24,
              }}
            >
              <Link href="/#faq" className="mcx-navlink">
                Dúvidas frequentes
              </Link>
              <Link href="/login" className="mcx-navlink">
                Já sou cliente — entrar
              </Link>
            </div>
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        <section style={{ padding: "clamp(20px,3vw,34px) 0 clamp(58px,7vw,96px)" }}>
          <div className="mcx-shell">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                marginBottom: 34,
              }}
            >
              <div className="mcx-toggle" role="group" aria-label="Ciclo de cobrança">
                <button
                  type="button"
                  className={cycle === "monthly" ? "on" : ""}
                  onClick={() => setCycle("monthly")}
                  aria-pressed={cycle === "monthly"}
                >
                  Mensal
                </button>
                <button
                  type="button"
                  className={cycle === "annual" ? "on" : ""}
                  onClick={() => setCycle("annual")}
                  aria-pressed={cycle === "annual"}
                >
                  Anual −{PLAN_ANNUAL_DISCOUNT_PERCENT}%
                </button>
              </div>
              <p className="mcx-mono" style={{ textTransform: "none", letterSpacing: ".04em" }}>
                {cycle === "monthly"
                  ? "Preços por mês, cobrança mensal."
                  : `Equivalente mensal com ${PLAN_ANNUAL_DISCOUNT_PERCENT}% de desconto — faturação anual (12 meses).`}
              </p>
            </div>

            <div className="mcx-plans">
              {SALES_PLANS.map((plan, i) => (
                <Reveal key={plan.slug} delay={i * 0.06}>
                  <div id={`plano-${plan.slug}`} style={{ height: "100%", scrollMarginTop: 90 }}>
                    <PlanCard plan={plan} cycle={cycle} highlighted={highlight === plan.slug} />
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={0.26}>
              <p
                className="mcx-mono"
                style={{
                  marginTop: 26,
                  textTransform: "none",
                  letterSpacing: ".03em",
                  lineHeight: 1.7,
                  textAlign: "center",
                }}
              >
                Número extra de WhatsApp: {priceBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês ·
                Conector de API adicional: {priceBRL(EXTERNAL_API_EXTRA_MONTHLY_BRL)}/mês
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section
          id="comparativo"
          style={{ padding: "0 0 clamp(58px,7vw,96px)", scrollMarginTop: 80 }}
        >
          <div className="mcx-shell">
            <Reveal>
              <SectionLabel>Comparativo</SectionLabel>
              <h2 className="mcx-h2">O que cada plano entrega.</h2>
              <p className="mcx-lead" style={{ marginTop: 16 }}>
                O Enterprise não entra no quadro — é contratado sob medida. Os valores no cabeçalho
                são o preço de lista mensal.
              </p>
            </Reveal>

            <Reveal delay={0.08}>
              <div className="mcx-table-wrap" style={{ marginTop: 28 }}>
                <table className="mcx-table">
                  <thead>
                    <tr>
                      <th scope="col" style={{ minWidth: 200 }}>
                        Funcionalidade
                      </th>
                      {SALES_PLANS_COMPARISON_COLUMNS.map((plan) => (
                        <th
                          key={plan.slug}
                          scope="col"
                          className={plan.accent === "popular" ? "pop" : undefined}
                          style={{ textAlign: "center", minWidth: 116 }}
                        >
                          <span style={{ display: "block" }}>{plan.name}</span>
                          <span
                            style={{
                              display: "block",
                              marginTop: 3,
                              color: "var(--muted)",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {plan.priceMonthly != null
                              ? `${priceBRL(plan.priceMonthly)}/mês`
                              : "Sob consulta"}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PLAN_COMPARISON_SECTIONS.map((section) => (
                      <Fragment key={section.category}>
                        <tr className="mcx-cat">
                          <td colSpan={1 + SALES_PLANS_COMPARISON_COLUMNS.length}>
                            {section.category}
                          </td>
                        </tr>
                        {section.rows.map((row) => (
                          <tr key={row.label}>
                            <td>{row.label}</td>
                            {SALES_PLANS_COMPARISON_COLUMNS.map((plan) => (
                              <ComparisonCell
                                key={plan.slug}
                                value={row.cells[plan.slug] ?? false}
                              />
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Reveal>

            <Reveal delay={0.14}>
              <p
                className="mcx-mono"
                style={{
                  marginTop: 18,
                  textTransform: "none",
                  letterSpacing: ".03em",
                  lineHeight: 1.7,
                }}
              >
                Cada plano inclui duas linhas de WhatsApp: uma para os leads que vêm de formulários
                do Meta e outra para o WhatsApp direto. Cada número adicional custa{" "}
                {priceBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section
          id="especialista"
          style={{ padding: "0 0 clamp(70px,8vw,110px)", scrollMarginTop: 80 }}
        >
          <div className="mcx-shell">
            <Reveal>
              <div className="mcx-final">
                <div
                  className="mcx-aurora"
                  style={{
                    width: 460,
                    height: 460,
                    bottom: -290,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "rgba(242,68,0,.3)",
                  }}
                />
                <div style={{ position: "relative", zIndex: 1 }}>
                  <span className="mcx-chip" style={{ marginBottom: 22 }}>
                    <Sparkles size={12} style={{ color: "var(--brand-hi)" }} />
                    Fale com quem monta a operação
                  </span>
                  <h2 className="mcx-h2" style={{ maxWidth: 680, margin: "0 auto" }}>
                    Na dúvida entre dois planos?
                  </h2>
                  <p className="mcx-lead" style={{ margin: "20px auto 0", textAlign: "center" }}>
                    Tire dúvidas sobre limites de leads, integrações, números adicionais ou migração
                    do seu atendimento atual — sem compromisso.
                  </p>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 12,
                      justifyContent: "center",
                      marginTop: 30,
                    }}
                  >
                    <a
                      href={whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mcx-btn mcx-btn-primary mcx-btn-lg"
                      data-lead-gate="contact"
                    >
                      Conversar no WhatsApp
                      <ArrowRight size={17} />
                    </a>
                    <Link href="/" className="mcx-btn mcx-btn-ghost mcx-btn-lg">
                      Voltar ao site
                    </Link>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <McxFooter />
    </McxPage>
  );
}
