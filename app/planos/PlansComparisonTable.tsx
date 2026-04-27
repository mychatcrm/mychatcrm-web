import { Fragment } from "react";
import {
  PLAN_COMPARISON_SECTIONS,
  SALES_PLANS_COMPARISON_COLUMNS,
  WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL,
  type PlanComparisonCellValue,
} from "@/lib/plans";
import { cn, formatBRL } from "@/lib/utils";

function PlanCell({ value }: { value: PlanComparisonCellValue }) {
  const isString = typeof value === "string";
  return (
    <td className="border-t border-line/40 px-1.5 py-1.5 text-center align-middle sm:px-2">
      {isString ? (
        <span
          className="inline-block max-w-[5.5rem] truncate text-[11px] font-semibold tabular-nums text-content sm:max-w-none sm:text-xs"
          title={value}
        >
          {value}
        </span>
      ) : (
        <span
          className={cn(
            "inline-flex min-h-[1.75rem] min-w-[1.75rem] items-center justify-center text-sm font-bold sm:text-[15px]",
            value ? "text-primary" : "text-content-faint/70",
          )}
          aria-label={value ? "Incluído neste plano" : "Não incluído neste plano"}
        >
          {value ? "✓" : "✗"}
        </span>
      )}
    </td>
  );
}

export function PlansComparisonTable() {
  return (
    <section
      id="comparativo-planos"
      className="mx-auto mt-10 max-w-5xl scroll-mt-24 px-3 sm:mt-12 sm:px-5 lg:px-6"
      aria-labelledby="comparativo-planos-heading"
    >
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary sm:text-xs">Comparativo</p>
        <h2
          id="comparativo-planos-heading"
          className="mt-2 font-display text-xl font-bold tracking-tight text-content sm:text-2xl"
        >
          O que cada plano entrega
        </h2>
        <div className="title-accent-line mx-auto" aria-hidden />
        <p className="mt-2 text-[11px] leading-snug text-content-muted sm:text-xs">
          ✓ incluído · ✗ não incluído. Números = limites de referência (mensal ou pacote). O plano{" "}
          <span className="font-semibold text-content-secondary">Enterprise</span> não entra neste quadro — é contratado sob
          medida. Os valores no cabeçalho são o preço de lista mensal; acima dos cards pode alternar para assinatura anual com
          desconto.
        </p>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line/80 bg-surface-card shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.05]">
        <table className="w-full min-w-[480px] border-collapse text-left text-[11px] text-content sm:min-w-[520px] sm:text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-deep/50">
              <th
                scope="col"
                className="sticky left-0 z-20 w-[min(42%,11rem)] max-w-[11rem] border-r border-line/50 bg-surface-deep/95 px-2 py-2 text-[9px] font-semibold uppercase leading-tight tracking-wide text-content-muted backdrop-blur-sm sm:w-auto sm:max-w-[13rem] sm:px-2.5 sm:py-2 sm:text-[10px]"
              >
                Funcionalidade
              </th>
              {SALES_PLANS_COMPARISON_COLUMNS.map((plan) => (
                <th
                  key={plan.slug}
                  scope="col"
                  className={cn(
                    "min-w-[4.5rem] px-1 py-2 text-center align-bottom sm:min-w-[5.25rem] sm:px-1.5",
                    plan.accent === "popular" && "bg-primary/[0.06]",
                    plan.accent === "enterprise" && "bg-surface-deep/50",
                  )}
                >
                  <span className="block font-display text-[11px] font-bold leading-tight text-content sm:text-xs">{plan.name}</span>
                  <span className="mt-0.5 block text-[9px] font-semibold tabular-nums leading-tight text-primary sm:text-[10px]">
                    {plan.priceMonthly != null ? `${formatBRL(plan.priceMonthly)}/mês` : "Sob consulta"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAN_COMPARISON_SECTIONS.map((section) => (
              <Fragment key={section.category}>
                <tr className="bg-surface-deep/45">
                  <td
                    colSpan={1 + SALES_PLANS_COMPARISON_COLUMNS.length}
                    className="border-y border-line/60 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-content sm:text-[10px]"
                  >
                    {section.category}
                  </td>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.label} className="transition hover:bg-surface-deep/[0.12]">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-[11rem] border-r border-line/40 bg-surface-card/95 px-2 py-1.5 text-left text-[10px] font-medium leading-snug text-content backdrop-blur-sm sm:max-w-[13rem] sm:px-2.5 sm:text-[11px]"
                    >
                      {row.label}
                    </th>
                    {SALES_PLANS_COMPARISON_COLUMNS.map((plan) => (
                      <PlanCell key={plan.slug} value={row.cells[plan.slug] ?? false} />
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-center text-[10px] leading-snug text-content-faint sm:text-[11px]">
        Preços e limites de demonstração. Em cada plano pode ligar <span className="font-medium text-content-secondary">apenas 1</span>{" "}
        WhatsApp Business: ou pela <span className="font-medium text-content-secondary">API oficial da Meta</span>, ou pela{" "}
        <span className="font-medium text-content-secondary">ligação por QR Code</span> — são formas alternativas para a mesma
        linha, não duas linhas incluídas. Cada número adicional custa {formatBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês.
        Detalhes comerciais na vitrine e no checkout.
      </p>
    </section>
  );
}
