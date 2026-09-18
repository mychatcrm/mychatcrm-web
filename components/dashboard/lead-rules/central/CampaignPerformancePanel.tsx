"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";
import type { MetaLeadCentralFilters } from "@/lib/meta-leads/central-filters";

type PerformanceRow = {
  campaignId: string;
  campaignName: string;
  leads: number;
  contacted: number;
  responded: number;
  scheduled: number;
  won: number;
  lost: number;
  medianFirstReplyMinutes: number | null;
  spend: number | null;
  currency: string | null;
  costPerLead: number | null;
  costPerScheduled: number | null;
  costPerWon: number | null;
};

type PerformanceResponse = {
  rows?: PerformanceRow[];
  totals?: { leads: number; responded: number; scheduled: number; won: number; spend: number | null };
  spendAvailable?: boolean;
  canSeeSpend?: boolean;
  truncated?: boolean;
};

function money(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  try {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : "BRL",
    });
  } catch {
    return value.toFixed(2);
  }
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function minutes(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${value} min`;
  if (value < 1440) return `${Math.round(value / 60)} h`;
  return `${Math.round(value / 1440)} d`;
}

/**
 * Desempenho por campanha — do clique ao fechamento.
 *
 * Com `ads_read` concedido, cada linha mostra o que a campanha custou e o que
 * ela entregou: CPL, custo por agendamento e custo por venda. Sem a concessão,
 * as colunas de dinheiro somem em vez de mostrar zero — campanha "de graça"
 * seria pior do que não informar.
 */
export function CampaignPerformancePanel({
  filters,
  queryString,
}: {
  filters: MetaLeadCentralFilters;
  queryString: string;
}) {
  const { isLight } = usePanelAppearance();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/client/meta/lead-events/performance?${queryString}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await response.json()) as PerformanceResponse & { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Não foi possível calcular o desempenho.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao calcular.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  // Só calcula quando o bloco está aberto: é a consulta mais cara da Central.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // A leitura em texto é sob pedido: consome IA e nem sempre acrescenta ao que
  // a tabela já diz.
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const response = await fetch(`/api/client/meta/lead-events/summary?${queryString}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const json = (await response.json()) as { summary?: string | null; error?: string };
      setSummary(json.summary ?? json.error ?? null);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [queryString]);

  const rows = data?.rows ?? [];
  const showSpend = Boolean(data?.canSeeSpend && data?.spendAvailable);
  const currency = rows.find((row) => row.currency)?.currency ?? null;

  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border",
        isLight ? "border-slate-200/80 bg-surface-deep" : "border-line/80 bg-surface-card/80",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-2">
          <BarChart3 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block font-display text-[15px] font-bold tracking-tight text-content">
              Desempenho por campanha
            </span>
            <span className="block text-[12px] text-content-muted">
              {filters.from && filters.to
                ? "Leads, resposta, agendamento e fechamento — com custo por resultado."
                : "Escolha um período nos filtros para ver o custo por resultado."}
            </span>
          </span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
        )}
      </button>

      {open ? (
        <div className="border-t border-line/40 px-4 py-4 sm:px-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-content-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Calculando…
            </div>
          ) : error ? (
            <p className="py-6 text-center text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-xs text-content-muted">
              Nenhum lead com campanha identificada neste recorte.
            </p>
          ) : (
            <>
              {data?.canSeeSpend && !data?.spendAvailable ? (
                <p className="mb-3 rounded-lg border border-line bg-surface-elevated/40 px-3 py-2 text-[11px] text-content-muted">
                  Investimento indisponível: a conta Meta ligada não concedeu leitura de anúncios
                  (<code>ads_read</code>), ou o período escolhido não tem dados. Reconecte em Integrações → API Meta
                  para ver CPL e custo por venda.
                </p>
              ) : null}

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => void loadSummary()} disabled={summaryLoading}>
                  {summaryLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Ler estes números para mim
                </Button>
              </div>

              {summary ? (
                <p
                  className={cn(
                    "mb-3 whitespace-pre-line rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
                    isLight ? "border-slate-200 bg-white text-slate-700" : "border-line/70 bg-surface-deep/50 text-content-secondary",
                  )}
                >
                  {summary}
                </p>
              ) : null}

              <div className="min-w-0 overflow-x-auto">
                <table className="min-w-full divide-y divide-line/50 text-left text-xs">
                  <thead className={cn(isLight ? "bg-slate-50" : "bg-surface-elevated/40")}>
                    <tr>
                      {[
                        "Campanha",
                        "Leads",
                        "Respondeu",
                        "Agendou",
                        "Ganho",
                        "1ª resposta",
                        ...(showSpend ? ["Investido", "CPL", "Custo/agend.", "Custo/venda"] : []),
                      ].map((header) => (
                        <th
                          key={header}
                          className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-[0.08em] text-content-muted"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/40">
                    {rows.map((row) => (
                      <tr key={row.campaignId}>
                        <td className="max-w-[220px] truncate px-3 py-2 font-medium text-content">
                          {row.campaignName}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-content">{row.leads.toLocaleString("pt-BR")}</td>
                        <td className="px-3 py-2 tabular-nums text-content-secondary">
                          {row.responded.toLocaleString("pt-BR")}
                          <span className="ml-1 text-[10px] text-content-faint">{percent(row.responded, row.leads)}</span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-content-secondary">
                          {row.scheduled.toLocaleString("pt-BR")}
                          <span className="ml-1 text-[10px] text-content-faint">{percent(row.scheduled, row.leads)}</span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-content-secondary">
                          {row.won.toLocaleString("pt-BR")}
                          <span className="ml-1 text-[10px] text-content-faint">{percent(row.won, row.leads)}</span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-content-muted">
                          {minutes(row.medianFirstReplyMinutes)}
                        </td>
                        {showSpend ? (
                          <>
                            <td className="px-3 py-2 tabular-nums text-content">{money(row.spend, row.currency)}</td>
                            <td className="px-3 py-2 tabular-nums text-content-secondary">
                              {money(row.costPerLead, row.currency)}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-content-secondary">
                              {money(row.costPerScheduled, row.currency)}
                            </td>
                            <td className="px-3 py-2 tabular-nums font-semibold text-content">
                              {money(row.costPerWon, row.currency)}
                            </td>
                          </>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                  {data?.totals ? (
                    <tfoot>
                      <tr className={cn("border-t", isLight ? "bg-slate-50" : "bg-surface-elevated/30")}>
                        <td className="px-3 py-2 font-semibold text-content">Total</td>
                        <td className="px-3 py-2 tabular-nums font-semibold text-content">
                          {data.totals.leads.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-content-secondary">
                          {data.totals.responded.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-content-secondary">
                          {data.totals.scheduled.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-content-secondary">
                          {data.totals.won.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-2" />
                        {showSpend ? (
                          <>
                            <td className="px-3 py-2 tabular-nums font-semibold text-content">
                              {money(data.totals.spend, currency)}
                            </td>
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2" />
                          </>
                        ) : null}
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>

              {data?.truncated ? (
                <p className="mt-2 text-[11px] text-content-muted">
                  Recorte muito grande: os números consideram os leads mais recentes do período.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
